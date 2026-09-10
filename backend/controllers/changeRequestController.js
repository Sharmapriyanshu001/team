import ChangeRequest, { CHANGE_PRIORITIES, CHANGE_STATUSES } from "../models/ChangeRequest.js";
import Project from "../models/Project.js";
import User, { ADMIN_ROLES } from "../models/User.js";

import { clientOf } from "../utils/actor.js";
import { logActivity } from "../utils/activity.js";
import { notifyClient, notifyUser, notifyUsers } from "../utils/notify.js";

/**
 * Change requests, from every side of them.
 *
 * One controller rather than one per panel, for the reason reportChainController
 * is also one: the direction of travel is worked out from who is asking, not
 * from which door they came through. A client raising a change, an employee
 * reporting progress on it and an admin reading the history are three views of
 * one row, and three copies of this logic would be three places for the status
 * vocabulary to drift.
 *
 * WHO SEES WHAT
 *
 *   client     requests on their own projects, and only theirs
 *   employee   the ones handed to them, plus their own projects' — so they can
 *              see the change they are about to be asked about
 *   leader     everything on the projects they run
 *   admin      all of it, which is what "monitor the complete history" means
 *
 * Every one of those is a filter on `project`, so nothing is reachable through
 * this file that the asker could not already reach through their own project
 * list. That is the whole access model, and it is deliberately the only one —
 * a per-request permission would be a second answer to a question the project
 * scope has already answered.
 */

/* ----------------------------------------------------------------- scope */

/**
 * Who is asking, and which requests that lets them touch.
 *
 * Returns a query fragment rather than a role string, for the same reason the
 * sales scopes do: a handler that spreads it into its query is scoped, and one
 * that forgets is obviously unscoped when you read it.
 *
 * "Is this a client" is asked through clientOf rather than by testing
 * req.client, which is always truthy — see utils/actor.js.
 */
export const audienceOf = async (req) => {
  const asClient = clientOf(req);

  if (asClient) {
    const projectIds = await Project.find({ client: asClient._id }).distinct("_id");
    return {
      kind: "client",
      actor: asClient,
      name: asClient.name,
      /**
       * Filtered on the client id as well as the project list. Belt and
       * braces on purpose: a project reassigned to another client between the
       * request being raised and being read would otherwise still match.
       */
      filter: { client: asClient._id, project: { $in: projectIds } },
      canManage: false,
      canDecide: false,
    };
  }

  if (req.admin) {
    return {
      kind: "admin",
      actor: req.admin,
      name: req.admin.name,
      filter: {},
      canManage: true,
      canDecide: true,
    };
  }

  if (req.leader) {
    const { getScope } = await import("../middleware/leaderAuth.js");
    const { projectIds } = await getScope(req);
    return {
      kind: "leader",
      actor: req.leader,
      name: req.leader.name,
      filter: { project: { $in: projectIds } },
      canManage: true,
      canDecide: true,
    };
  }

  if (req.employee) {
    const projectIds = await Project.find({ members: req.employee._id }).distinct("_id");
    return {
      kind: "employee",
      actor: req.employee,
      name: req.employee.name,
      /**
       * Theirs, or on a project they are on. The second half is what lets
       * somebody pick up an unassigned change rather than waiting to be
       * handed it — and it grants nothing new, since they are already on the
       * project the change is about.
       */
      filter: {
        $or: [{ assignedTo: req.employee._id }, { project: { $in: projectIds } }],
      },
      canManage: false,
      canDecide: false,
    };
  }

  return null;
};

/**
 * The refusal for a request outside the asker's scope.
 *
 * A 404 rather than a 403, matching the rest of this codebase: telling
 * somebody a request exists but is not theirs leaks the shape of another
 * client's project one refusal at a time.
 */
const notFound = (res) => res.status(404).json({ message: "That request was not found" });

const REFS = [
  { path: "assignedTo", select: "name email designation role" },
  { path: "assignedBy", select: "name" },
  { path: "project", select: "name code status" },
  { path: "client", select: "name company" },
];

const withRefs = (query) => REFS.reduce((q, ref) => q.populate(ref.path, ref.select), query);

/**
 * What the asker is allowed to do with this row, decided once and sent with
 * it. The screens follow this rather than re-deriving it from the role, so a
 * button never appears for an action the server will refuse.
 */
const shape = (doc, audience) => {
  const mine = String(doc.assignedTo?._id || doc.assignedTo || "") === String(audience.actor._id);

  return {
    ...doc.toObject(),
    can: {
      assign: audience.canManage,
      // The assignee works on it; a manager can also move it along, because
      // somebody has to when the assignee is away.
      progress: audience.canManage || mine,
      decide: audience.canDecide,
      // Both sides can add to the thread. That is what makes it a thread.
      comment: true,
    },
  };
};

const adminIds = () => User.find({ role: { $in: ADMIN_ROLES }, status: "active" }).distinct("_id");

/** Everybody on the team side who should hear about a change on this project. */
const projectWatchers = async (projectId, extra = []) => {
  const project = await Project.findById(projectId).select("operationsManager members");
  const ids = [
    ...(project ? [project.operationsManager, ...(project.members || [])] : []),
    ...(await adminIds()),
    ...extra,
  ];

  // De-duplicated, because a leader who is also the assignee should be told
  // once rather than three times.
  return [...new Set(ids.filter(Boolean).map(String))];
};

/* ------------------------------------------------------------------ list */

/**
 * GET .../change-requests
 *
 * The same endpoint for all four panels. Filters are optional and additive;
 * the scope filter is not, and is applied first.
 */
export const listChangeRequests = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(401).json({ message: "Not authorized" });

    const filters = [audience.filter];

    if (req.query.project && req.query.project !== "all") {
      filters.push({ project: req.query.project });
    }
    if (req.query.status && req.query.status !== "all") {
      filters.push({ status: req.query.status });
    }
    if (req.query.priority && req.query.priority !== "all") {
      filters.push({ priority: req.query.priority });
    }
    if (req.query.view === "open") {
      filters.push({ status: { $in: ["open", "in_progress"] } });
    }
    if (req.query.view === "mine") {
      filters.push({ assignedTo: audience.actor._id });
    }
    if (req.query.view === "unassigned") {
      filters.push({ assignedTo: null, status: { $in: ["open", "in_progress"] } });
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.push({ $or: [{ title: regex }, { detail: regex }] });
    }

    /**
     * $and rather than a merged object: the scope for an employee is an $or,
     * and so is the search. Assigning either onto the query would drop the
     * other — and the one that would be dropped is the scope.
     */
    const query = { $and: filters };

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);

    const [items, total, open, inProgress, done] = await Promise.all([
      withRefs(ChangeRequest.find(query))
        .sort({ status: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ChangeRequest.countDocuments(query),
      // Counted over the scope, not the filters, so the tiles keep saying how
      // much is outstanding while somebody filters to completed.
      ChangeRequest.countDocuments({ $and: [audience.filter, { status: "open" }] }),
      ChangeRequest.countDocuments({ $and: [audience.filter, { status: "in_progress" }] }),
      ChangeRequest.countDocuments({ $and: [audience.filter, { status: "completed" }] }),
    ]);

    return res.status(200).json({
      items: items.map((doc) => shape(doc, audience)),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      counts: { open, inProgress, completed: done, outstanding: open + inProgress },
      audience: audience.kind,
      can: { create: audience.kind === "client", manage: audience.canManage },
    });
  } catch (err) {
    console.error("listChangeRequests error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- get one */

export const getChangeRequest = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(401).json({ message: "Not authorized" });

    const doc = await withRefs(
      ChangeRequest.findOne({ $and: [audience.filter, { _id: req.params.id }] })
    ).populate("updates.author", "name");

    if (!doc) return notFound(res);

    /**
     * Who this particular request can go to, sent with it.
     *
     * The project's own people, not a company-wide staff list — the assign
     * handler refuses anybody who is not on the project, so a dropdown built
     * from anything wider is a list of choices that will be rejected. Read
     * here rather than from a lookup endpoint each panel would have to call,
     * because the answer depends on the request and the panels do not
     * otherwise know the project's roster.
     *
     * Only for somebody who can actually assign. There is no reason a client
     * should receive the names of everybody who could be put on their change.
     */
    let assignableTo = [];
    if (audience.canManage) {
      const project = await Project.findById(doc.project._id || doc.project)
        .select("operationsManager members")
        .populate("operationsManager", "name designation role")
        .populate("members", "name designation role");

      const roster = [project?.operationsManager, ...(project?.members || [])].filter(Boolean);
      const seen = new Set();
      assignableTo = roster
        .filter((p) => !seen.has(String(p._id)) && seen.add(String(p._id)))
        .map((p) => ({
          _id: p._id,
          name: p.name,
          designation: p.designation || "",
          role: p.role,
        }));
    }

    /**
     * Opening it is what counts as having seen it, and which dot goes out
     * depends on which side opened it. Saved without awaiting the read it
     * belongs to — a failed dot must never fail the request.
     */
    if (audience.kind === "client" && !doc.seenByClient) {
      ChangeRequest.updateOne({ _id: doc._id }, { $set: { seenByClient: true } }).catch(() => {});
    }
    if (audience.kind !== "client" && !doc.seenByTeam) {
      ChangeRequest.updateOne({ _id: doc._id }, { $set: { seenByTeam: true } }).catch(() => {});
    }

    return res.status(200).json({ item: shape(doc, audience), assignableTo });
  } catch (err) {
    if (err.name === "CastError") return notFound(res);
    console.error("getChangeRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- raise it */

/**
 * POST /api/client/change-requests
 *
 * Clients only. A change request is by definition something the client asked
 * for; one raised by the team is just work, and work already has a task board.
 */
export const createChangeRequest = async (req, res) => {
  try {
    const asClient = clientOf(req);
    if (!asClient) {
      return res.status(403).json({ message: "Only a client can raise a change request" });
    }

    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Say what needs changing" });

    const projectId = String(req.body.project || "").trim();
    if (!projectId) return res.status(400).json({ message: "Choose which project this is about" });

    /**
     * Checked against the database rather than against a list the screen sent.
     * This is the whole access control on creation: a client can only raise a
     * request against a project booked under their own name.
     */
    const project = await Project.findOne({ _id: projectId, client: asClient._id }).select(
      "name operationsManager members"
    );
    if (!project) return res.status(404).json({ message: "That project was not found" });

    const doc = await ChangeRequest.create({
      project: project._id,
      client: asClient._id,
      title,
      detail: String(req.body.detail || "").trim(),
      priority: CHANGE_PRIORITIES.includes(req.body.priority) ? req.body.priority : "medium",
      status: "open",
      // New to the team, already seen by the person who just wrote it
      seenByTeam: false,
      seenByClient: true,
      updates: [
        {
          author: asClient._id,
          authorModel: "Client",
          authorName: asClient.name,
          authorRole: "client",
          note: String(req.body.detail || "").trim() || title,
          status: "open",
          progress: 0,
        },
      ],
    });

    logActivity(req, {
      action: "created",
      entity: "Change request",
      entityId: doc._id,
      message: `${asClient.name} requested a change on ${project.name}: "${title}"`,
    });

    notifyUsers(await projectWatchers(project._id), {
      type: "general",
      title: "A client requested a change",
      message: `${project.name} — ${title}`,
      link: "/admin/change-requests",
    });

    const item = await withRefs(ChangeRequest.findById(doc._id));
    return res.status(201).json({
      message: "Your request has been sent to the team",
      item: shape(item, await audienceOf(req)),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") {
      return res.status(400).json({ message: "That project was not found" });
    }
    console.error("createChangeRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- assign */

/**
 * PUT .../change-requests/:id/assign
 *
 * Handing it to somebody. Admin and leader only — a client cannot choose who
 * does their work, and an employee putting a change on a colleague is how a
 * queue gets gamed.
 */
export const assignChangeRequest = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(401).json({ message: "Not authorized" });
    if (!audience.canManage) {
      return res.status(403).json({ message: "You cannot assign change requests" });
    }

    const doc = await ChangeRequest.findOne({ $and: [audience.filter, { _id: req.params.id }] });
    if (!doc) return notFound(res);

    const assignedTo = String(req.body.assignedTo || "").trim();
    if (!assignedTo) return res.status(400).json({ message: "Choose who this is for" });

    /**
     * The assignee has to be on the project. Otherwise a change could be put
     * on somebody who cannot open the project it belongs to, and they would
     * receive a notification about work they are unable to see.
     */
    const project = await Project.findById(doc.project).select("name operationsManager members");
    const onProject = [project?.operationsManager, ...(project?.members || [])]
      .filter(Boolean)
      .some((id) => String(id) === assignedTo);

    if (!onProject) {
      return res.status(400).json({
        message: "That person is not on this project — add them to it first",
      });
    }

    const changed = String(doc.assignedTo || "") !== assignedTo;

    doc.assignedTo = assignedTo;
    doc.assignedBy = audience.actor._id;
    doc.assignedAt = new Date();
    if (doc.status === "open") doc.status = "in_progress";

    doc.updates.push({
      author: audience.actor._id,
      authorModel: "User",
      authorName: audience.name,
      authorRole: audience.kind,
      note: String(req.body.note || "").trim() || "Assigned",
      status: doc.status,
    });

    // The client should see that somebody picked it up
    doc.seenByClient = false;
    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Change request",
      entityId: doc._id,
      message: `"${doc.title}" assigned`,
    });

    if (changed) {
      notifyUser(assignedTo, {
        type: "task",
        title: "A client change was assigned to you",
        message: `${project?.name || "Project"} — ${doc.title}`,
        link: "/employee/change-requests",
      });
    }

    notifyClient(doc.client, {
      type: "general",
      title: "Somebody is on your change request",
      message: doc.title,
      link: "/client/requests",
    });

    const item = await withRefs(ChangeRequest.findById(doc._id));
    return res.status(200).json({ message: "Assigned", item: shape(item, audience) });
  } catch (err) {
    if (err.name === "CastError") return notFound(res);
    console.error("assignChangeRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------- work on it, and close */

/**
 * PUT .../change-requests/:id
 *
 * One route for every move a request makes, because they are all the same
 * event: somebody says something about it and it may advance. What each caller
 * is allowed to move differs, and that is decided here rather than by which
 * route they found.
 *
 *   client    may add a note. Nothing else — a client who could set the
 *             progress on their own request could report it done.
 *   assignee  progress, status up to completed, and a note
 *   manager   all of that, plus rejecting it
 */
export const updateChangeRequest = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(401).json({ message: "Not authorized" });

    const doc = await ChangeRequest.findOne({ $and: [audience.filter, { _id: req.params.id }] });
    if (!doc) return notFound(res);

    const mine = String(doc.assignedTo || "") === String(audience.actor._id);
    const mayWork = audience.canManage || mine;

    const note = String(req.body.note || "").trim();
    const entry = {
      author: audience.actor._id,
      authorModel: audience.kind === "client" ? "Client" : "User",
      authorName: audience.name,
      authorRole: audience.kind,
      note,
    };

    let moved = false;

    if (mayWork && req.body.progress !== undefined) {
      const next = Math.min(100, Math.max(0, Number(req.body.progress) || 0));
      if (next !== doc.progress) moved = true;
      doc.progress = next;
      entry.progress = next;
    }

    if (mayWork && req.body.status !== undefined) {
      const next = String(req.body.status);
      if (!CHANGE_STATUSES.includes(next)) {
        return res.status(400).json({ message: "That is not a status" });
      }

      /**
       * Turning a client's request down is a decision, not an update. An
       * assignee who could reject one could close anything they did not fancy
       * doing, and the client would be told it had been declined by the
       * company rather than by a person who was asked to do it.
       */
      if (next === "rejected" && !audience.canDecide) {
        return res.status(403).json({
          message: "Only a manager or an administrator can turn a request down",
        });
      }
      if (next === "rejected" && !note) {
        return res.status(400).json({ message: "Give the client a reason" });
      }
      if (next === "rejected") doc.closingNote = note;

      if (next !== doc.status) moved = true;
      doc.status = next;
      entry.status = next;
    }

    if (!note && !moved) {
      return res.status(400).json({ message: "Write an update, or move it along" });
    }

    doc.updates.push(entry);

    // Whoever did not write this should see that it happened
    if (audience.kind === "client") doc.seenByTeam = false;
    else doc.seenByClient = false;

    await doc.save();

    logActivity(req, {
      action: "updated",
      entity: "Change request",
      entityId: doc._id,
      message: `"${doc.title}" — ${entry.status || `${doc.progress}%`}${note ? `: ${note}` : ""}`,
    });

    const project = await Project.findById(doc.project).select("name");

    if (audience.kind === "client") {
      // The client said something; the people carrying it should know
      notifyUsers(await projectWatchers(doc.project, [doc.assignedTo]), {
        type: "general",
        title: "A client added to their change request",
        message: `${project?.name || "Project"} — ${doc.title}`,
        link: "/admin/change-requests",
      });
    } else {
      notifyClient(doc.client, {
        type: "general",
        title:
          doc.status === "completed"
            ? "Your change request is done"
            : doc.status === "rejected"
              ? "A change request was declined"
              : "Progress on your change request",
        message: `${doc.title} — ${doc.status === "rejected" ? note : `${doc.progress}%`}`,
        link: "/client/requests",
      });

      /**
       * A manager hears when work they are answerable for finishes. Only on
       * the move into a closed state, and never when they closed it
       * themselves.
       */
      if (["completed", "rejected"].includes(entry.status)) {
        const watchers = (await projectWatchers(doc.project)).filter(
          (id) => id !== String(audience.actor._id)
        );
        notifyUsers(watchers, {
          type: "general",
          title: `Change request ${entry.status}`,
          message: `${project?.name || "Project"} — ${doc.title}`,
          link: "/admin/change-requests",
        });
      }
    }

    const item = await withRefs(ChangeRequest.findById(doc._id)).populate(
      "updates.author",
      "name"
    );
    return res.status(200).json({ message: "Update saved", item: shape(item, audience) });
  } catch (err) {
    if (err.name === "CastError") return notFound(res);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("updateChangeRequest error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- the dots */

/** GET .../change-requests/new-count */
export const countNewChangeRequests = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(200).json({ count: 0 });

    const unseen = audience.kind === "client" ? { seenByClient: false } : { seenByTeam: false };

    const count = await ChangeRequest.countDocuments({
      $and: [audience.filter, unseen, { status: { $in: ["open", "in_progress"] } }],
    });

    return res.status(200).json({ count });
  } catch (err) {
    console.error("countNewChangeRequests error:", err);
    // A dot that fails to load reads as "nothing new", never as an error
    return res.status(200).json({ count: 0 });
  }
};
