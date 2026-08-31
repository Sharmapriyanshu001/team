import Task from "../../models/Task.js";
import Project from "../../models/Project.js";
import User from "../../models/User.js";
import { assignmentRecord } from "../../utils/projectTeam.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const POPULATE = [
  { path: "project", select: "name code" },
  { path: "assignedTo", select: "name email designation" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

// Deleting or signing off work stays with the projects a leader runs.
const findOwnTask = async (req, id) => {
  const { projectIds } = await getScope(req);
  return Task.findOne({ _id: id, project: { $in: projectIds } });
};

/**
 * Reading or working on a task covers one more case: the admin can hand work
 * straight to a leader, and that task may sit outside the projects they run.
 */
const findVisibleTask = async (req, id) => {
  const { projectIds } = await getScope(req);
  return Task.findOne({
    _id: id,
    $or: [{ project: { $in: projectIds } }, { assignedTo: req.leader._id }],
  });
};

/**
 * Reject a payload that points at someone else's project, or at somebody who
 * is not there to be given work.
 *
 * The project check is ownership: it has to be one the admin gave this
 * leader. The person check is a role, deliberately, and not the reporting
 * line — a leader may hand work to any active employee, not only their own
 * direct reports, because work does not fall neatly along the org chart.
 *
 * What that still refuses is everything that is not an employee: another
 * team leader, an admin, a client, a disabled account. Asked of the database
 * rather than of the payload, so no request shape talks its way past it.
 */
const validateRefs = async (req, payload) => {
  const { projectIds } = await getScope(req);

  if (!payload.project) return "Pick a project for this task";
  if (!projectIds.some((id) => String(id) === String(payload.project))) {
    return "That project is not one of yours";
  }

  if (payload.assignedTo) {
    const assignable = await User.exists({
      _id: payload.assignedTo,
      role: "employee",
      status: "active",
    });
    if (!assignable) return "Work can only be given to an active employee";
  }

  return null;
};

/* ------------------------------------------------------ the same job twice */

/**
 * Has this person already been given this exact job on this project?
 *
 * "Exact" is the title, ignoring case and the spaces round it, because that is
 * what a leader reads when they wonder whether they already sent something —
 * "Fix the export" and "fix the export  " are the same instruction to a human
 * and should be the same instruction here.
 *
 * Open work only. A task that was finished is not a reason to refuse the same
 * job again: plenty of work is genuinely repeated, and a check that never
 * forgets would make "Weekly report" un-assignable for good after the first
 * one. What this stops is the real mistake — sending somebody something they
 * are still holding, so it lands on their list twice and neither copy means
 * anything.
 */
const alreadyHasTask = async ({ project, assignedTo, title, exclude }) => {
  const clean = String(title || "").trim();
  if (!project || !assignedTo || !clean) return null;

  return Task.findOne({
    ...(exclude ? { _id: { $ne: exclude } } : {}),
    project,
    assignedTo,
    title: new RegExp(`^${escapeRegex(clean)}$`, "i"),
    status: { $ne: "completed" },
  }).select("_id title status");
};

/** "Rahul", "Rahul and Neha", "Rahul, Neha and Kim" */
const listNames = (names) =>
  names.length < 2 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * The refusal itself, shared by creating and reassigning so both say the same
 * thing. 409 rather than 400: nothing about the request is malformed, it is
 * the state of the project that makes it impossible.
 */
const refuseDuplicate = async (res, { ids, title }) => {
  const people = await User.find({ _id: { $in: ids } }).select("name");
  const names = people.map((person) => person.name);
  const one = names.length === 1;

  return res.status(409).json({
    // Read by the leader's screen to put this in front of them rather than in
    // a corner — a duplicate is a decision to take, not a footnote.
    code: "duplicate_task",
    duplicates: names,
    title,
    message: `${listNames(names)} ${one ? "has" : "have"} already been given "${title}" on this project, and ${one ? "has" : "have"} not finished it yet.`,
  });
};

/* --------------------------------------------------------- the red dot */

/**
 * Only work handed to the leader in person counts here — a task they created
 * for someone on their team is not news to them.
 */

// GET /api/leader/tasks/new-count
export const countNewTasks = async (req, res) => {
  try {
    const count = await Task.countDocuments({
      assignedTo: req.leader._id,
      seenByAssignee: false,
    });
    return res.status(200).json({ count });
  } catch (err) {
    console.error("leader countNewTasks error:", err);
    return res.status(200).json({ count: 0 });
  }
};

// PUT /api/leader/tasks/seen
export const markTasksSeen = async (req, res) => {
  try {
    await Task.updateMany(
      { assignedTo: req.leader._id, seenByAssignee: false },
      { $set: { seenByAssignee: true } }
    );
    return res.status(200).json({ count: 0 });
  } catch (err) {
    console.error("leader markTasksSeen error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/tasks
export const listTasks = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);
    // Their projects, plus anything the admin handed to them personally
    const query = {
      $or: [{ project: { $in: projectIds } }, { assignedTo: req.leader._id }],
    };

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.priority && req.query.priority !== "all") query.priority = req.query.priority;

    // "Assigned to me" — work the admin gave the leader themselves
    if (req.query.view === "mine") query.assignedTo = req.leader._id;

    if (req.query.project && req.query.project !== "all") {
      if (!projectIds.some((id) => String(id) === String(req.query.project))) {
        return res.status(403).json({ message: "That project is not one of yours" });
      }
      query.project = req.query.project;
    }

    if (req.query.assignedTo && req.query.assignedTo !== "all") {
      query.assignedTo = req.query.assignedTo;
    }

    // "Assigned Tasks" = everything on their projects that is somebody else's.
    // Not narrowed to direct reports any more: a leader can give work to any
    // employee, and work they handed out has to appear on the screen that says
    // what they handed out.
    if (req.query.view === "assigned") query.assignedTo = { $nin: [null, req.leader._id] };
    if (req.query.view === "unassigned") query.assignedTo = null;

    if (req.query.due === "today" || req.query.due === "overdue") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (req.query.due === "today") query.dueDate = { $gte: today, $lt: tomorrow };
      else {
        query.dueDate = { $lt: today };
        query.status = { $ne: "completed" };
      }
    }

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total] = await Promise.all([
      withRefs(Task.find(query))
        .sort({ dueDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Task.countDocuments(query),
    ]);

    return res.status(200).json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    console.error("leader listTasks error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/tasks/:id
export const getTask = async (req, res) => {
  try {
    const existing = await findVisibleTask(req, req.params.id);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    const item = await withRefs(Task.findById(existing._id));
    return res.status(200).json({ item });
  } catch (err) {
    console.error("leader getTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Handing somebody work on a project puts them on it.
 *
 * Without this, a leader could assign a task to one of their people and the
 * project it belongs to would still not appear on that person's screen —
 * their project list, their scope and the check that lets them submit code
 * against it are all driven by Project.members. The task would arrive with
 * nowhere to do it.
 *
 * Narrow on purpose: only a project this leader actually runs, and only for
 * an active employee — both re-checked in the query itself rather than
 * trusted from the payload. Returns true only when it genuinely added
 * somebody, so the caller can say so.
 */
const ensureOnProject = async (req, task) => {
  if (!task?.project || !task?.assignedTo) return false;

  const assignable = await User.exists({
    _id: task.assignedTo,
    role: "employee",
    status: "active",
  });
  if (!assignable) return false;

  /**
   * A stale record can be left behind by somebody being taken off and put
   * back, so the old one goes in the same breath as the id — different
   * arrays, so Mongo is happy to do both at once.
   */
  const result = await Project.updateOne(
    {
      _id: task.project,
      teamLeader: req.leader._id,
      members: { $ne: task.assignedTo },
    },
    {
      $addToSet: { members: task.assignedTo },
      $pull: { memberAssignments: { user: task.assignedTo } },
    }
  );

  if (!result.modifiedCount) return false;

  // Same record the Assign Work screen writes, so the employee is told who
  // put them on the project whichever way it happened
  await Project.updateOne(
    { _id: task.project },
    { $push: { memberAssignments: assignmentRecord(task.assignedTo, req.leader) } }
  );

  return true;
};
// POST /api/leader/tasks
/**
 * One job, several people: `assignees` is a list, and each name on it gets a
 * task of its own.
 *
 * Deliberately that rather than widening `assignedTo` into an array. Every
 * screen in this app, on all three panels, counts and filters work by whose it
 * is — the employee's own list, the review queue, the dashboards, the red dot.
 * Three rows are already understood by all of them; an array would have to be
 * taught to each one, and the first screen that was missed would quietly stop
 * showing somebody their work. Three rows also let each person move their own
 * copy along without dragging the other two with it.
 *
 * A plain `assignedTo`, and no assignee at all, both still behave exactly as
 * they did.
 */
export const createTask = async (req, res) => {
  try {
    const base = { ...req.body };
    delete base.assignees;
    delete base.assignedTo;
    if (!base.dueDate) delete base.dueDate;

    const raw = Array.isArray(req.body.assignees) ? req.body.assignees : [req.body.assignedTo];
    const assignees = [
      ...new Set(raw.map((value) => String(value?._id || value || "").trim()).filter(Boolean)),
    ];

    // Nobody named is still allowed — a task can be parked on the project and
    // handed out afterwards from the row's own assignee dropdown.
    const targets = assignees.length ? assignees : [null];

    /**
     * Everybody is checked before anybody is created. Validating inside the
     * loop below would leave the first two people holding a task and the third
     * refused, with the response saying only that something went wrong.
     */
    for (const assignedTo of targets) {
      const problem = await validateRefs(req, { ...req.body, assignedTo });
      if (problem) return res.status(400).json({ message: problem });
    }

    /**
     * Nobody gets it twice — and if one name on the list already holds it, the
     * whole batch is refused rather than quietly assigning the other two.
     *
     * Silently skipping would be the friendlier-looking choice and the worse
     * one: the leader pressed Assign for three people and would be told it
     * worked, with no reading of the result that tells them it went to two.
     * Refusing puts the decision back where it belongs — untick that name, or
     * change the title.
     */
    const clashing = [];
    for (const assignedTo of targets) {
      if (!assignedTo) continue;
      const held = await alreadyHasTask({
        project: req.body.project,
        assignedTo,
        title: base.title,
      });
      if (held) clashing.push(assignedTo);
    }

    if (clashing.length) {
      return refuseDuplicate(res, { ids: clashing, title: String(base.title || "").trim() });
    }

    const created = [];
    let joined = 0;

    for (const assignedTo of targets) {
      const doc = await Task.create({
        ...base,
        ...(assignedTo ? { assignedTo } : {}),
        assignedBy: req.leader._id,
        // Work a leader hands down is new to that person too — same red dot
        seenByAssignee: !assignedTo,
      });

      // Giving them the work gives them the project it belongs to
      if (await ensureOnProject(req, doc)) joined += 1;
      created.push(doc);
    }

    const items = await Promise.all(created.map((doc) => withRefs(Task.findById(doc._id))));

    logActivity(req, {
        action: "created",
        entity: "Task",
        entityId: created[0]._id,
        message: `${req.leader.name} created task "${created[0].title}"${
          assignees.length > 1 ? ` for ${assignees.length} people` : ""
        }${joined ? ` and put ${joined === 1 ? "them" : `${joined} of them`} on the project` : ""}`,
    });

    created.forEach((doc) => {
      if (!doc.assignedTo) return;
      notifyUser(doc.assignedTo, {
        type: "task",
        title: "New task assigned",
        message: `${req.leader.name} assigned you "${doc.title}"`,
        link: "/employee/tasks/pending",
      });
    });

    return res.status(201).json({
      message:
        assignees.length > 1
          ? `Task assigned to ${assignees.length} people`
          : joined
            ? "Task created — they are now on the project"
            : "Task created",
      // Still singular as well, so anything already reading `item` keeps working
      item: items[0],
      items,
      joinedProject: joined > 0,
    });
  } catch (err) {
    console.error("leader createTask error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/tasks/:id
export const updateTask = async (req, res) => {
  try {
    const existing = await findVisibleTask(req, req.params.id);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    const payload = { ...req.body };
    delete payload._id;
    delete payload.assignedBy;
    // The dot belongs to the assignee's own "seen" action, not to an edit
    delete payload.seenByAssignee;

    if (payload.project || payload.assignedTo) {
      const problem = await validateRefs(req, {
        project: payload.project || existing.project,
        assignedTo: payload.assignedTo,
      });
      if (problem) return res.status(400).json({ message: problem });
    }

    if (payload.assignedTo === "") payload.assignedTo = null;
    if (payload.dueDate === "") payload.dueDate = null;

    /**
     * Moving a task onto somebody, or renaming one, can land the same job on a
     * person twice just as surely as assigning it can — so the rule is checked
     * on the way through here too, rather than only on the door it was first
     * noticed at. `exclude` is this task itself: it is not its own duplicate.
     */
    const nextAssignee = payload.assignedTo ?? existing.assignedTo;
    if (nextAssignee && (payload.assignedTo || payload.title || payload.project)) {
      const held = await alreadyHasTask({
        project: payload.project || existing.project,
        assignedTo: nextAssignee,
        title: payload.title ?? existing.title,
        exclude: existing._id,
      });

      if (held) {
        return refuseDuplicate(res, {
          ids: [nextAssignee],
          title: String(payload.title ?? existing.title).trim(),
        });
      }
    }

    // Moving a task onto someone else makes it unseen work for them
    if (payload.assignedTo && String(payload.assignedTo) !== String(existing.assignedTo || "")) {
      payload.seenByAssignee = false;
    }

    Object.assign(existing, payload);
    await existing.save();

    // Same on a reassignment: the new person gets the project too
    const joined = await ensureOnProject(req, existing);

    const item = await withRefs(Task.findById(existing._id));

    logActivity(req, {
        action: "updated",
        entity: "Task",
        entityId: existing._id,
        message: `${req.leader.name} updated task "${existing.title}"`,
    });

    return res.status(200).json({
      message: joined ? "Task updated — they are now on the project" : "Task updated",
      item,
      joinedProject: joined,
    });
  } catch (err) {
    console.error("leader updateTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /api/leader/tasks/:id
export const removeTask = async (req, res) => {
  try {
    const existing = await findOwnTask(req, req.params.id);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    await existing.deleteOne();

    logActivity(req, {
        action: "deleted",
        entity: "Task",
        entityId: existing._id,
        message: `${req.leader.name} deleted task "${existing.title}"`,
    });

    return res.status(200).json({ message: "Task deleted" });
  } catch (err) {
    console.error("leader removeTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------ daily work review */

// GET /api/leader/review?date=YYYY-MM-DD
// Work submitted for sign-off, plus what the team actually closed that day.
export const getReviewQueue = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);

    const day = req.query.date ? new Date(req.query.date) : new Date();
    day.setHours(0, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const [awaiting, completedToday, stats] = await Promise.all([
      withRefs(Task.find({ project: { $in: projectIds }, status: "review" })).sort({
        updatedAt: -1,
      }),
      withRefs(
        Task.find({
          project: { $in: projectIds },
          status: "completed",
          completedAt: { $gte: day, $lt: nextDay },
        })
      ).sort({ completedAt: -1 }),
      Task.aggregate([
        { $match: { assignedTo: { $in: teamIds }, updatedAt: { $gte: day, $lt: nextDay } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      date: day,
      awaiting,
      completedToday,
      activity: stats.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
    });
  } catch (err) {
    console.error("leader getReviewQueue error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/leader/review/:id  { decision: "approve" | "rework", reviewRating, reviewNote }
export const reviewTask = async (req, res) => {
  try {
    const existing = await findOwnTask(req, req.params.id);
    if (!existing) return res.status(404).json({ message: "Task not found" });

    const { decision, reviewRating, reviewNote } = req.body;
    if (!["approve", "rework"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve or rework" });
    }

    existing.status = decision === "approve" ? "completed" : "in_progress";
    if (reviewRating !== undefined) {
      existing.reviewRating = Math.min(5, Math.max(0, Number(reviewRating) || 0));
    }
    if (reviewNote !== undefined) existing.reviewNote = reviewNote;

    await existing.save();

    logActivity(req, {
        action: "updated",
        entity: "Task",
        entityId: existing._id,
        message: `${req.leader.name} ${
          decision === "approve" ? "approved" : "sent back"
        } "${existing.title}"`,
    });

    if (existing.assignedTo) {
      notifyUser(existing.assignedTo, {
        type: "review",
        title: decision === "approve" ? "Work approved" : "Changes requested",
        message: `"${existing.title}" — ${reviewNote || "reviewed by your team leader"}`,
        link: "/team-leader/tasks/assigned",
      });
    }

    const item = await withRefs(Task.findById(existing._id));
    return res.status(200).json({ message: "Review saved", item });
  } catch (err) {
    console.error("leader reviewTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
