import Client from "../../models/Client.js";
import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Team, { ACTIVE_TEAM } from "../../models/Team.js";
import User from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { notifyUser, notifyUsers } from "../../utils/notify.js";
import { estimateCompletion } from "../../utils/projectEstimate.js";

/**
 * The handover: a deal Sales won becoming work Operations owns.
 *
 * Sales already opens the project — clients/:id/project carries the agreed
 * requirements into it — but the project landed with nobody's name on it, so
 * it sat in "planning" until an administrator happened to notice. The gap
 * between "we sold it" and "somebody is building it" was a notification and a
 * hope.
 *
 * This closes it. The Sales head names who is running the delivery and, if
 * they know, who is on it. That is the whole of Sales's authority over a
 * project and deliberately so:
 *
 *   they MAY   name the operations manager and the initial team, once
 *   they MAY   read the project's progress afterwards
 *   they MAY NOT edit the scope, the tasks, the dates or the budget
 *
 * Everything in the second list belongs to whoever is delivering it. A sales
 * account that could move a delivery date is a sales account that will, and
 * the person answering for the date would find out afterwards.
 */

/** Who a project can be handed to. Operations runs delivery; Sales does not. */
const DELIVERY_ROLES = ["manager", "operations_manager", "employee"];

const REFS = [
  { path: "client", select: "name company" },
  { path: "operationsManager", select: "name email designation role" },
  { path: "members", select: "name email designation role" },
];

const withRefs = (query) => REFS.reduce((q, r) => q.populate(r.path, r.select), query);

/** The clients this sales account may see. Every query here starts here. */
const myClientIds = async (req) =>
  Client.find(req.salesScope.client).distinct("_id");

/* ----------------------------------------------------------------- list */

/**
 * GET /api/sales/projects
 *
 * What Sales sold, and where it has got to. Scoped to their own clients by
 * the same fragment every other list in this panel uses — an executive sees
 * the projects of the accounts they own, the head sees all of them.
 */
export const listSalesProjects = async (req, res) => {
  try {
    const clientIds = await myClientIds(req);

    const filters = [{ client: { $in: clientIds } }];

    if (req.query.status && req.query.status !== "all") {
      filters.push({ status: req.query.status });
    }
    if (req.query.view === "unassigned") {
      // The whole reason this screen exists: sold, and nobody is on it
      filters.push({ operationsManager: null });
    }
    if (req.query.client && req.query.client !== "all") {
      filters.push({ client: req.query.client });
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.push({ $or: [{ name: regex }, { code: regex }] });
    }

    const query = { $and: filters };

    const projects = await withRefs(Project.find(query)).sort({ createdAt: -1 }).limit(200);

    /** Progress from the tasks, in one pass rather than a query per project. */
    const taskRows = await Task.aggregate([
      { $match: { project: { $in: projects.map((p) => p._id) } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
    ]);
    const byProject = taskRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});

    const now = new Date();

    const items = projects.map((project) => {
      const stats = byProject[String(project._id)] || { total: 0, completed: 0 };
      const estimate = estimateCompletion(project, stats, now);

      return {
        _id: project._id,
        name: project.name,
        code: project.code,
        status: project.status,
        priority: project.priority,
        progress: project.progress,
        client: project.client,
        operationsManager: project.operationsManager,
        teamSize: project.members?.length || 0,
        startDate: project.startDate,
        endDate: project.endDate,
        /**
         * The value is here and not on the client's own screen, which is not
         * an inconsistency: this is the figure Sales agreed and is measured
         * on. What has been invoiced and received is the administrator's, and
         * no route in this panel returns it.
         */
        value: project.budget,
        tasks: stats.total,
        tasksCompleted: stats.completed,
        taskProgress: estimate.taskProgress,
        estimatedDate: estimate.estimatedDate,
        estimateBasis: estimate.basis,
        behindPlan: estimate.behindPlan,
        assigned: Boolean(project.operationsManager),
      };
    });

    const unassigned = items.filter((i) => !i.assigned).length;

    return res.status(200).json({
      items,
      counts: {
        total: items.length,
        unassigned,
        live: items.filter((i) => ["planning", "in_progress"].includes(i.status)).length,
        done: items.filter((i) => i.status === "completed").length,
      },
      canAssign: Boolean(req.salesScope.isSalesHead),
    });
  } catch (err) {
    console.error("listSalesProjects error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------- who it can go to */

/**
 * GET /api/sales/delivery-team
 *
 * The names a project can be handed to, grouped so the form can put the
 * operations managers at the top — they are the usual answer, and a flat list
 * of sixty people is one where somebody picks the wrong Rohit.
 *
 * Names, roles and departments only. Sales has no business reading an
 * employee's contact details, salary or documents, and this is the only route
 * in the panel that touches the staff directory at all.
 */
export const deliveryTeam = async (req, res) => {
  try {
    const people = await User.find({ role: { $in: DELIVERY_ROLES }, status: "active" })
      .select("name role designation department")
      .sort({ role: 1, name: 1 });

    const teams = await Team.find({ ...ACTIVE_TEAM, kind: { $in: ["operations", "other"] } })
      .select("name kind manager")
      .populate("manager", "name")
      .sort({ name: 1 });

    /**
     * Two roles reach this panel and they are not the same job. A manager runs
     * a department; an operations manager runs a project. Labelling both
     * "manager" is how a project gets handed to the wrong one.
     */
    const label = {
      manager: "Department Managers",
      operations_manager: "Operations Managers",
      employee: "Developers & staff",
    };

    return res.status(200).json({
      items: people.map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        group: label[p.role] || "Staff",
        designation: p.designation || "",
        department: p.department || "",
      })),
      teams: teams.map((t) => ({
        _id: t._id,
        name: t.name,
        kind: t.kind,
        manager: t.manager?.name || "",
      })),
    });
  } catch (err) {
    console.error("deliveryTeam error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- assign */

/**
 * PUT /api/sales/projects/:id/assign
 *
 * Head only, enforced by the route. Naming who delivers a project is the
 * handover itself, and an executive doing it for their own deal is how a
 * project ends up assigned to whoever owed them a favour.
 */
export const assignProject = async (req, res) => {
  try {
    const clientIds = await myClientIds(req);

    const project = await Project.findOne({
      _id: req.params.id,
      client: { $in: clientIds },
    }).populate("client", "name");

    if (!project) return res.status(404).json({ message: "That project was not found" });

    const leaderId = String(req.body.operationsManager || "").trim();
    if (!leaderId) {
      return res.status(400).json({ message: "Choose who will run this project" });
    }

    /**
     * Checked against the database, not against the list the form was built
     * from. A dropdown is a suggestion; this is the check — and without it an
     * id typed into the request could put a client account or a sales
     * executive in charge of delivery.
     */
    const leader = await User.findOne({
      _id: leaderId,
      role: { $in: ["manager", "operations_manager"] },
      status: "active",
    }).select("name role");

    if (!leader) {
      return res.status(400).json({
        message: "A project has to be run by an operations manager or a department manager",
      });
    }

    const memberIds = Array.isArray(req.body.members) ? req.body.members.map(String) : [];
    const members = memberIds.length
      ? await User.find({
          _id: { $in: memberIds },
          role: { $in: DELIVERY_ROLES },
          status: "active",
        }).select("_id name")
      : [];

    if (memberIds.length && members.length !== memberIds.length) {
      return res.status(400).json({ message: "One of those people cannot be put on a project" });
    }

    const wasAssigned = Boolean(project.operationsManager);
    const changedLeader = String(project.operationsManager || "") !== String(leader._id);

    project.operationsManager = leader._id;

    /**
     * The lead is on the team too. Otherwise the person running the project
     * is not a member of it, and every screen that lists "who is on this"
     * leaves out the one name that answers for it.
     */
    const roster = new Set([String(leader._id), ...members.map((m) => String(m._id))]);
    project.members = [...roster];

    if (req.body.team) project.team = req.body.team;

    /**
     * Handing it over is what starts it. A project sitting in "planning" with
     * a named owner is a state nobody acts on — the owner assumes it has not
     * been released to them, and Sales assumes it is under way.
     */
    if (project.status === "planning") project.status = "in_progress";
    if (!project.startDate) project.startDate = new Date();
    if (req.body.endDate) project.endDate = req.body.endDate;

    await project.save();

    logActivity(req, {
      action: "updated",
      entity: "Project",
      entityId: project._id,
      message: `${project.name} handed to ${leader.name} for delivery`,
    });

    if (changedLeader) {
      notifyUser(leader._id, {
        type: "project",
        title: wasAssigned ? "A project was moved to you" : "A new project is yours to run",
        message: `${project.name} — ${project.client?.name || "client"}. ${
          members.length ? `${members.length} on the team.` : "No team on it yet."
        }`,
        link: "/operation-manager/projects",
      });
    }

    const joined = members.filter((m) => String(m._id) !== String(leader._id));
    notifyUsers(
      joined.map((m) => m._id),
      {
        type: "project",
        title: "You were added to a project",
        message: `${project.name} — ${leader.name} is running it`,
        link: "/employee/projects",
      }
    );

    const item = await withRefs(Project.findById(project._id));

    return res.status(200).json({
      message: `${project.name} is now ${leader.name}'s to deliver`,
      item,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That project was not found" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("assignProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
