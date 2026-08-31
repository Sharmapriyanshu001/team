import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import User from "../../models/User.js";
import CodeProject from "../../models/CodeProject.js";
import CodeSubmission from "../../models/CodeSubmission.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import { syncAssignments } from "../../utils/projectTeam.js";

/**
 * "Assign Work" — the team leader's one screen for handing a project down.
 *
 * The loop it closes: the admin gives a project to a leader, the leader puts
 * their own people on it and gives them tasks, and whatever those people
 * submit comes back to that same leader for review. Before this, the middle
 * step had no home — a leader could create a task but could not put anybody on
 * the project it belonged to, which is the thing that makes the project show up
 * on the employee's screen at all.
 *
 * What a leader may do here is bounded by two things, and they are worth
 * stating precisely because one of them is narrower than it first looks:
 *
 *   the project must be one the admin gave this leader, and
 *   the person must be an active employee
 *
 * The second is a role check, not a reporting-line one. A leader can put any
 * employee on their project, not only their own direct reports — work does
 * not fall neatly along the org chart, and a leader who needs a hand from
 * somebody else's developer should not have to go to an admin for it.
 *
 * What stays out of reach: another team leader, an admin, a client, an
 * inactive account, a project they do not run, and every field that says who
 * owns the project — the client, the budget, the deadline, the team leader.
 * All of it is checked below rather than left to the screen.
 */

const idOf = (value) => String(value?._id || value || "");

/** Ids in `next` that were not already in `before`. */
const newlyAdded = (before, next) => {
  const had = new Set((before || []).map(idOf));
  return (next || []).map(idOf).filter((id) => !had.has(id));
};

/**
 * Read a list of ids off a request body, however the caller shaped it, and
 * keep only the ones that are genuinely assignable.
 *
 * This is the whole permission story for both handlers, and it is decided
 * against the database rather than against the payload: whatever arrives, what
 * comes back is the subset that really are active employees. An id belonging
 * to a team leader, an admin, a client or a disabled account is simply not in
 * the result, so there is no request shape that gets one through.
 *
 * The caller compares the two lengths and refuses the whole request if they
 * differ — quietly dropping an id would leave the leader believing they had
 * assigned somebody.
 */
const assignableOnly = async (raw) => {
  const wanted = [...new Set((Array.isArray(raw) ? raw : []).map(idOf).filter(Boolean))];
  if (!wanted.length) return { wanted, allowed: [] };

  const allowed = await User.find({
    _id: { $in: wanted },
    role: "employee",
    status: "active",
  }).distinct("_id");

  return { wanted, allowed: allowed.map(idOf) };
};

/* ------------------------------------------------------------------ board */

/**
 * GET /api/leader/assign-work
 *
 * Everything the screen needs in one call: the projects this leader was given,
 * who is on each, what their team is carrying, and what has come back for
 * review. One round trip because the page is useless in pieces.
 */
export const getAssignBoard = async (req, res) => {
  try {
    const { teamIds } = await getScope(req);
    const mine = new Set(teamIds.map(idOf));

    const projects = await Project.find({ teamLeader: req.leader._id })
      .populate("client", "name company")
      .populate("members", "name email designation department")
      .sort({ createdAt: -1 });

    const projectIds = projects.map((p) => p._id);

    const [team, taskRows, codeProjects, submissionRows, memberTaskRows] = await Promise.all([
      /**
       * Every active employee, not just this leader's own reports. Their own
       * people are flagged and sorted to the top so the common case is still
       * the first thing in the list, but the rest are there to be picked.
       */
      User.find({ role: "employee", status: "active" })
        .select("name email designation department reportsTo")
        .sort({ name: 1 }),

      // Task counts per project, so each card can say what is actually moving
      Task.aggregate([
        { $match: { project: { $in: projectIds } } },
        { $group: { _id: { project: "$project", status: "$status" }, count: { $sum: 1 } } },
      ]),

      /**
       * The uploaded workspaces attached to these projects — but only the ones
       * this leader is on. A code project the admin did not assign to them is
       * not theirs to hand out, and it must not even appear here.
       */
      CodeProject.find({
        project: { $in: projectIds },
        teamLeaders: req.leader._id,
        deletedAt: null,
      })
        .select("name stack project employees workspaceReady fileCount permissions")
        .populate("employees", "name designation"),

      // What the team has sent back to this leader
      CodeSubmission.aggregate([
        { $match: { reviewer: req.leader._id } },
        { $group: { _id: { project: "$project", status: "$status" }, count: { $sum: 1 } } },
      ]),

      // Open work per person, so the leader can see who is already loaded up.
      // Counted across everything, not just their projects — the point is
      // whether that person has room, and other people's work still takes it.
      Task.aggregate([
        { $match: { status: { $in: ["pending", "in_progress", "review"] } } },
        { $group: { _id: "$assignedTo", open: { $sum: 1 } } },
      ]),
    ]);

    const countsFrom = (rows) =>
      rows.reduce((acc, row) => {
        const key = idOf(row._id.project);
        if (!key) return acc;
        acc[key] = { ...(acc[key] || {}), [row._id.status]: row.count };
        return acc;
      }, {});

    const tasksByProject = countsFrom(taskRows);
    const submissionsByProject = countsFrom(submissionRows);

    const openByMember = memberTaskRows.reduce((acc, row) => {
      acc[idOf(row._id)] = row.open;
      return acc;
    }, {});

    const codeByProject = codeProjects.reduce((acc, doc) => {
      const key = idOf(doc.project);
      (acc[key] ||= []).push(doc);
      return acc;
    }, {});

    const items = projects.map((project) => {
      const key = idOf(project._id);
      const tasks = tasksByProject[key] || {};
      const submissions = submissionsByProject[key] || {};

      return {
        ...project.toObject(),
        taskCounts: {
          pending: tasks.pending || 0,
          in_progress: tasks.in_progress || 0,
          review: tasks.review || 0,
          completed: tasks.completed || 0,
        },
        submissionCounts: {
          pending: submissions.pending || 0,
          changes_required: submissions.changes_required || 0,
          approved: submissions.approved || 0,
        },
        codeProjects: codeByProject[key] || [],
      };
    });

    return res.status(200).json({
      items,
      total: items.length,
      team: team
        .map((member) => ({
          ...member.toObject(),
          openTasks: openByMember[idOf(member._id)] || 0,
          reportsToMe: mine.has(idOf(member._id)),
        }))
        // Their own people first, then everybody else, each alphabetically
        .sort((a, b) =>
          a.reportsToMe === b.reportsToMe
            ? a.name.localeCompare(b.name)
            : a.reportsToMe
              ? -1
              : 1
        ),
    });
  } catch (err) {
    console.error("leader getAssignBoard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- project members */

/**
 * PUT /api/leader/projects/:id/members   { members: [userId] }
 *
 * Putting people on a project the admin gave this leader.
 *
 * This is the step that makes a project appear on an employee's own screen:
 * their project list, their scope, and the check that lets them file code
 * against it are all driven by Project.members. So it is working access, and
 * nothing more — the client, the budget, the deadline, the team leader and the
 * project's owner are all untouched here and unreachable from this panel.
 */
export const updateProjectMembers = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      teamLeader: req.leader._id,
    });

    // Same answer for "no such project" and "not yours"
    if (!project) return res.status(404).json({ message: "Project not found" });

    const requested = Array.isArray(req.body?.members) ? req.body.members : null;

    if (!requested) {
      return res.status(400).json({ message: "Send the list of people who should be on it" });
    }

    const { wanted, allowed } = await assignableOnly(requested);

    /**
     * Silently dropping ids would leave the leader thinking they added
     * somebody. If anything was refused, say so and change nothing — the
     * screen can then show them why.
     */
    if (allowed.length !== wanted.length) {
      return res.status(403).json({
        message: "Only active employees can be put on a project",
      });
    }

    /**
     * Anybody on the project who is not an active employee stays on it — a
     * team leader the admin put there, say. Without this, a leader saving the
     * list from a screen that never showed those people would quietly remove
     * them.
     */
    const employees = new Set(
      (
        await User.find({
          _id: { $in: (project.members || []).map(idOf) },
          role: "employee",
          status: "active",
        }).distinct("_id")
      ).map(idOf)
    );
    const untouched = (project.members || []).map(idOf).filter((id) => !employees.has(id));

    const next = [...new Set([...untouched, ...allowed])];
    const added = newlyAdded(project.members, next);
    const removed = newlyAdded(next, project.members);

    project.members = next;
    // So the employee's own screen can say who put them on it, and when
    project.memberAssignments = syncAssignments(project.memberAssignments, next, req.leader);
    await project.save();

    logActivity(req, {
      action: "updated",
      entity: "Project",
      entityId: project._id,
      message: `${req.leader.name} set the team on "${project.name}" — ${next.length} member${
        next.length === 1 ? "" : "s"
      }${added.length ? `, added ${added.length}` : ""}${removed.length ? `, removed ${removed.length}` : ""}`,
    });

    added.forEach((userId) =>
      notifyUser(userId, {
        type: "project",
        title: "You were added to a project",
        message: `${req.leader.name} put you on "${project.name}"`,
        link: "/employee/projects/active",
      })
    );

    removed.forEach((userId) =>
      notifyUser(userId, {
        type: "project",
        title: "You were taken off a project",
        message: `"${project.name}" is no longer on your list`,
        link: "/employee/projects/active",
      })
    );

    const item = await Project.findById(project._id)
      .populate("client", "name company")
      .populate("members", "name email designation department")
      .populate("teamLeader", "name email");

    return res.status(200).json({
      message: added.length
        ? `${added.length} added to "${project.name}"`
        : `Team updated on "${project.name}"`,
      item,
    });
  } catch (err) {
    console.error("leader updateProjectMembers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------- workspace access */

/**
 * PUT /api/leader/code-projects/:id/employees   { employees: [userId] }
 *
 * Giving the team the workspace, so "the leader sends the project down" ends
 * with the employee able to open the code rather than just read the project's
 * name.
 *
 * A leader is sharing access they already hold, downwards, with people who
 * already report to them. That is the only shape allowed:
 *
 *   the code project must be one the admin assigned to this leader
 *   every id must be an employee reporting to this leader
 *   teamLeaders, the per-project permissions, the archive and the project's
 *   own record are not writable from here at all
 *
 * What an employee may then *do* in that workspace is still the admin's
 * setting, read from the project, not from this request.
 */
export const shareCodeProjectWithTeam = async (req, res) => {
  try {
    const project = await CodeProject.findOne({
      _id: req.params.id,
      teamLeaders: req.leader._id,
      deletedAt: null,
    });

    if (!project) return res.status(404).json({ message: "Code project not found" });

    const requested = Array.isArray(req.body?.employees) ? req.body.employees : null;

    if (!requested) {
      return res.status(400).json({ message: "Send the list of people who should have it" });
    }

    const { wanted, allowed } = await assignableOnly(requested);

    if (allowed.length !== wanted.length) {
      return res.status(403).json({
        message: "Only active employees can be given the workspace",
      });
    }

    /**
     * Anybody on it who is not an active employee is left exactly as they are.
     * The assignment list this leader manages is the employee half of it; the
     * team leaders on a code project are the admin's, and are edited on a
     * different field entirely.
     */
    const employees = new Set(
      (
        await User.find({
          _id: { $in: (project.employees || []).map(idOf) },
          role: "employee",
          status: "active",
        }).distinct("_id")
      ).map(idOf)
    );
    const untouched = (project.employees || []).map(idOf).filter((id) => !employees.has(id));

    const next = [...new Set([...untouched, ...allowed])];
    const added = newlyAdded(project.employees, next);
    const removed = newlyAdded(next, project.employees);

    project.employees = next;
    project.employeeAssignments = syncAssignments(
      project.employeeAssignments,
      next,
      req.leader
    );
    await project.save();

    logActivity(req, {
      action: "updated",
      entity: "Code Project",
      entityId: project._id,
      message: `${req.leader.name} gave "${project.name}" to ${allowed.length} employee${
        allowed.length === 1 ? "" : "s"
      }${removed.length ? `, took it from ${removed.length}` : ""}`,
    });

    added.forEach((userId) =>
      notifyUser(userId, {
        type: "task",
        title: "A code project was assigned to you",
        message: `${req.leader.name} gave you "${project.name}"`,
        link: "/employee/code-projects",
      })
    );

    removed.forEach((userId) =>
      notifyUser(userId, {
        type: "task",
        title: "A code project was taken off your list",
        message: `"${project.name}" is no longer assigned to you`,
        link: "/employee/code-projects",
      })
    );

    const item = await CodeProject.findById(project._id)
      .select("name stack project employees workspaceReady fileCount permissions")
      .populate("employees", "name designation");

    return res.status(200).json({
      message: added.length
        ? `${added.length} can now open "${project.name}"`
        : `Access updated on "${project.name}"`,
      item,
    });
  } catch (err) {
    console.error("leader shareCodeProjectWithTeam error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
