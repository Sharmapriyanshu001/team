import Task from "../../models/Task.js";
import Project from "../../models/Project.js";
import User, { ADMIN_ROLES } from "../../models/User.js";
import FileDoc from "../../models/FileDoc.js";
import { assignmentRecord } from "../../utils/projectTeam.js";
import { removeStoredFile } from "../../utils/uploads.js";
import { getScope } from "../../middleware/leaderAuth.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import { taskLinkFor } from "../../utils/taskLink.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const POPULATE = [
  { path: "project", select: "name code" },
  { path: "team", select: "name kind" },
  { path: "assignedTo", select: "name email designation" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

/**
 * Where a manager's own work lives: their projects, and the departments they
 * run.
 *
 * The second half is what makes a department a department. Hiring somebody,
 * chasing a payment, writing a proposal — none of it belongs to a client
 * project, and until a task could be filed against the team itself a Sales
 * manager had nowhere to put any of the work their department actually does.
 * `Task.team` already existed for exactly this; nothing was writing it.
 */
const ownScope = async (req) => {
  const { projectIds, managedTeamIds } = await getScope(req);
  const clauses = [{ project: { $in: projectIds } }];
  if (managedTeamIds.length) clauses.push({ team: { $in: managedTeamIds } });
  return clauses;
};

// Deleting or signing off work stays with what a leader runs.
const findOwnTask = async (req, id) => {
  return Task.findOne({ _id: id, $or: await ownScope(req) });
};

/**
 * Reading or working on a task covers one more case: the admin can hand work
 * straight to a leader, and that task may sit outside the projects they run.
 */
const findVisibleTask = async (req, id) => {
  return Task.findOne({
    _id: id,
    $or: [...(await ownScope(req)), { assignedTo: req.leader._id }],
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
 * operations manager, an admin, a client, a disabled account. Asked of the database
 * rather than of the payload, so no request shape talks its way past it.
 */
const validateRefs = async (req, payload) => {
  const { projectIds, managedTeamIds, teamIds } = await getScope(req);

  /**
   * A task belongs to a project or to a department, and needs one of the two.
   * Neither leaves it floating with no owner and nowhere to appear; both is
   * allowed, and means project work booked to a department's numbers.
   */
  if (!payload.project && !payload.team) {
    return managedTeamIds.length
      ? "Pick a project or a department for this task"
      : "Pick a project for this task";
  }

  if (payload.project && !projectIds.some((id) => String(id) === String(payload.project))) {
    return "That project is not one of yours";
  }

  if (payload.team && !managedTeamIds.some((id) => String(id) === String(payload.team))) {
    return "That department is not one of yours";
  }

  if (payload.assignedTo) {
    /**
     * Who may be given work.
     *
     * A project task still goes to an active employee, as it always has. A
     * department task goes to anybody on the department — which is the point
     * of having one: a Sales manager's people are sales executives, not
     * employees, and an operations manager on the team is somebody a manager assigns
     * to rather than around.
     *
     * Both are asked of the database rather than of the payload, and neither
     * reaches an administrator: the chain runs downwards.
     */
    const person = await User.findOne({ _id: payload.assignedTo, status: "active" }).select("role");

    if (!person) return "Work can only be given to an active account";
    if (ADMIN_ROLES.includes(person.role)) return "Work cannot be assigned upwards";

    const onMyTeam = teamIds.some((id) => String(id) === String(payload.assignedTo));
    if (person.role !== "employee" && !onMyTeam) {
      return "Work can only be given to an employee or to somebody on your department";
    }
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
const alreadyHasTask = async ({ project, team, assignedTo, title, exclude }) => {
  const clean = String(title || "").trim();
  // Department work is checked the same way, against the team it sits on
  if ((!project && !team) || !assignedTo || !clean) return null;

  return Task.findOne({
    ...(exclude ? { _id: { $ne: exclude } } : {}),
    ...(project ? { project } : { team, project: null }),
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
const refuseDuplicate = async (res, { ids, title, where = "this project" }) => {
  const people = await User.find({ _id: { $in: ids } }).select("name");
  const names = people.map((person) => person.name);
  const one = names.length === 1;

  return res.status(409).json({
    // Read by the leader's screen to put this in front of them rather than in
    // a corner — a duplicate is a decision to take, not a footnote.
    code: "duplicate_task",
    duplicates: names,
    title,
    message: `${listNames(names)} ${one ? "has" : "have"} already been given "${title}" on ${where}, and ${one ? "has" : "have"} not finished it yet.`,
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
    const { projectIds, managedTeamIds } = await getScope(req);
    // Their projects and their departments, plus anything the admin handed to
    // them personally
    const query = {
      $or: [...(await ownScope(req)), { assignedTo: req.leader._id }],
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

    // One department at a time, for a manager who runs more than one
    if (req.query.team && req.query.team !== "all") {
      if (!managedTeamIds.some((id) => String(id) === String(req.query.team))) {
        return res.status(403).json({ message: "That department is not one of yours" });
      }
      query.team = req.query.team;
    }

    // Department work is everything filed against a team rather than a project
    if (req.query.view === "department") {
      query.team = { $in: managedTeamIds };
      query.project = null;
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
      /**
       * $and, not a second $or.
       *
       * Assigning `query.$or` here replaced the scope clause that was already
       * on it, so a search matched every task in the company rather than
       * every task of this leader's matching the text. Both conditions have
       * to hold, which is what $and says.
       */
      query.$and = [{ $or: query.$or }, { $or: [{ title: regex }, { description: regex }] }];
      delete query.$or;
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

    const [item, attachments] = await Promise.all([
      withRefs(Task.findById(existing._id)),
      FileDoc.find({ task: existing._id }).populate("uploadedBy", "name").sort({ createdAt: -1 }),
    ]);

    return res.status(200).json({ item, attachments });
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
      operationsManager: req.leader._id,
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
/**
 * The three fields a manager sets that are numbers or dates rather than text.
 *
 * Applied on the way in on both create and update, because the update path
 * spreads the whole body onto the document — so anything not squared off here
 * reaches the schema as whatever was typed. Mongoose would refuse a progress
 * of 500 with a validation error; refusing it here means the manager is told
 * "0 to 100" instead of a cast message.
 *
 * A field the request did not mention is left out of the result entirely, so
 * an edit that only renames a task does not reset its progress to zero.
 */
const sanitiseWork = (body) => {
  const out = {};

  if (body.progress !== undefined) {
    out.progress = Math.min(100, Math.max(0, Math.round(Number(body.progress) || 0)));
  }

  if (body.bonus !== undefined) {
    // Negative money on a task is a fine, and a fine is not this feature
    out.bonus = Math.max(0, Number(body.bonus) || 0);
  }

  // "" is how a form clears a date. undefined is how it leaves one alone.
  if (body.startDate !== undefined) out.startDate = body.startDate || null;

  return out;
};

/**
 * Start before finish. Checked rather than corrected, because there is no
 * right guess: a manager who typed the dates the wrong way round may have
 * meant either of them, and silently swapping them produces a schedule nobody
 * agreed to.
 */
const datesDisagree = (startDate, dueDate) =>
  startDate && dueDate && new Date(startDate) > new Date(dueDate)
    ? "The start date is after the due date"
    : null;

export const createTask = async (req, res) => {
  try {
    const base = { ...req.body, ...sanitiseWork(req.body) };
    delete base.assignees;
    delete base.assignedTo;
    if (!base.dueDate) delete base.dueDate;
    if (!base.startDate) delete base.startDate;

    const clash = datesDisagree(base.startDate, base.dueDate);
    if (clash) return res.status(400).json({ message: clash });

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
        team: req.body.team,
        assignedTo,
        title: base.title,
      });
      if (held) clashing.push(assignedTo);
    }

    if (clashing.length) {
      const { managedTeams } = await getScope(req);
      const dept = managedTeams.find((t) => String(t._id) === String(req.body.team));
      return refuseDuplicate(res, {
        ids: clashing,
        title: String(base.title || "").trim(),
        where: req.body.project ? "this project" : dept ? dept.name : "this department",
      });
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

    /**
     * Everybody is told where to find it, on the panel they actually sign in
     * to. Their role is read once here rather than assumed, because a
     * department task can land on a sales executive or an operations manager just as
     * easily as on an employee.
     */
    const assigneeRoles = new Map(
      (
        await User.find({ _id: { $in: created.map((d) => d.assignedTo).filter(Boolean) } }).select(
          "role"
        )
      ).map((person) => [String(person._id), person.role])
    );

    created.forEach((doc) => {
      if (!doc.assignedTo) return;
      notifyUser(doc.assignedTo, {
        type: "task",
        title: "New task assigned",
        message: `${req.leader.name} assigned you "${doc.title}"`,
        link: taskLinkFor(assigneeRoles.get(String(doc.assignedTo))),
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

    const payload = { ...req.body, ...sanitiseWork(req.body) };
    delete payload._id;
    delete payload.assignedBy;
    // Earning the bonus is the model's business, never the request's
    delete payload.bonusAwardedAt;
    // The dot belongs to the assignee's own "seen" action, not to an edit
    delete payload.seenByAssignee;

    if (payload.project || payload.team || payload.assignedTo) {
      const problem = await validateRefs(req, {
        project: payload.project || existing.project,
        team: payload.team || existing.team,
        assignedTo: payload.assignedTo,
      });
      if (problem) return res.status(400).json({ message: problem });
    }

    if (payload.assignedTo === "") payload.assignedTo = null;
    if (payload.dueDate === "") payload.dueDate = null;

    const clash = datesDisagree(
      payload.startDate ?? existing.startDate,
      payload.dueDate ?? existing.dueDate
    );
    if (clash) return res.status(400).json({ message: clash });

    /**
     * Moving a task onto somebody, or renaming one, can land the same job on a
     * person twice just as surely as assigning it can — so the rule is checked
     * on the way through here too, rather than only on the door it was first
     * noticed at. `exclude` is this task itself: it is not its own duplicate.
     */
    const nextAssignee = payload.assignedTo ?? existing.assignedTo;
    if (nextAssignee && (payload.assignedTo || payload.title || payload.project || payload.team)) {
      const held = await alreadyHasTask({
        project: payload.project || existing.project,
        team: payload.team || existing.team,
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
    const reassigned =
      payload.assignedTo && String(payload.assignedTo) !== String(existing.assignedTo || "");
    if (reassigned) payload.seenByAssignee = false;

    Object.assign(existing, payload);
    await existing.save();

    // Same on a reassignment: the new person gets the project too
    const joined = await ensureOnProject(req, existing);

    /**
     * And they are told, which they were not before: work moved onto somebody
     * by an edit arrived with no notification at all, so the only sign of it
     * was the red dot — and department work, which may live on a panel with
     * no task list yet, had not even that.
     */
    if (reassigned) {
      const person = await User.findById(existing.assignedTo).select("role");
      notifyUser(existing.assignedTo, {
        type: "task",
        title: "New task assigned",
        message: `${req.leader.name} assigned you "${existing.title}"`,
        link: taskLinkFor(person?.role),
      });
    }

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
      /**
       * The bonus is mentioned in the same breath as the approval, because
       * being told separately that money has appeared is how somebody ends up
       * unsure which piece of work it was for. Reads off bonusAwardedAt rather
       * than off the decision — the model decides whether it was earned, and
       * saying so here from the decision would be a second opinion that could
       * disagree with the record.
       */
      const earned = existing.bonus > 0 && existing.bonusAwardedAt;

      notifyUser(existing.assignedTo, {
        type: "review",
        title: earned
          ? `Work approved — ₹${existing.bonus.toLocaleString("en-IN")} bonus earned`
          : decision === "approve"
            ? "Work approved"
            : "Changes requested",
        message: `"${existing.title}" — ${reviewNote || "reviewed by your operations manager"}`,
        link: "/employee/bonuses",
      });
    }

    const item = await withRefs(Task.findById(existing._id));
    return res.status(200).json({ message: "Review saved", item });
  } catch (err) {
    console.error("leader reviewTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------- task attachments */

/**
 * A ZIP travelling with the brief.
 *
 * "Carry on from where this got to" is an ordinary thing for a manager to
 * ask, and until now there was nowhere to put the thing being carried on
 * from: the employee read the description and had to go and ask for the
 * files. A half-finished build, the assets, last week's export — whatever the
 * work starts from rides along with the task itself.
 *
 * Stored exactly the way an assigned file is, because that is what it is: the
 * same record, the same folder, the same download route and the same
 * permission check. Only the `task` link is new, and it is what lets the
 * employee's task screen find it.
 */

// POST /api/leader/tasks/:id/attachment   (multipart/form-data, field "file")
export const attachToTask = async (req, res) => {
  // A rejected request must take its temp archive with it — but once a record
  // points at those bytes, deleting them would strand it.
  let recorded = false;
  const discard = () => !recorded && req.file && removeStoredFile(req.file.filename);

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Choose a .zip file to attach" });
    }

    const task = await findOwnTask(req, req.params.id);
    if (!task) {
      discard();
      return res.status(404).json({ message: "Task not found" });
    }

    const title = (req.body.title || "").trim() || req.file.originalname.replace(/\.zip$/i, "");
    const note = (req.body.note || "").trim();

    /**
     * Whoever the task is on owns the file too, so it shows up in their own
     * Files screen and the hand-over can be signed off there. An unassigned
     * task's archive simply sits on the project until somebody is given it.
     */
    const assignee = task.assignedTo
      ? await User.findOne({ _id: task.assignedTo, status: "active" }).select("name role")
      : null;

    const assignable = assignee && ["employee", "operations_manager"].includes(assignee.role);

    const file = await FileDoc.create({
      title,
      description: note,
      category: "other",
      fileType: "zip",
      size: req.file.size,
      project: task.project || undefined,
      task: task._id,
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.leader._id,
      ...(assignable
        ? {
            assignedTo: assignee._id,
            assignedRole: assignee.role,
            assignedBy: req.leader._id,
            assignedAt: new Date(),
            assignmentNote: note,
            status: "assigned",
          }
        : { status: "available" }),
    });
    recorded = true;

    logActivity(req, {
      action: "created",
      entity: "File",
      entityId: file._id,
      message: `${req.leader.name} attached "${title}" to task "${task.title}"`,
    });

    if (assignable) {
      notifyUser(assignee._id, {
        type: "task",
        title: "A file came with your task",
        message: `${req.leader.name} attached "${title}" to "${task.title}"`,
        link: taskLinkFor(assignee.role),
      });
    }

    return res.status(201).json({ message: "File attached", item: file });
  } catch (err) {
    discard();
    console.error("leader attachToTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Removing one again — the wrong archive gets picked, and re-uploading
 * without this would leave the employee looking at two and guessing.
 *
 * Only from a task this manager runs, and only a file that is actually on
 * that task: both are in the query, so neither can be talked around.
 */
// DELETE /api/leader/tasks/:id/attachment/:fileId
export const removeTaskAttachment = async (req, res) => {
  try {
    const task = await findOwnTask(req, req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    const file = await FileDoc.findOne({ _id: req.params.fileId, task: task._id });
    if (!file) return res.status(404).json({ message: "That file is not on this task" });

    await file.deleteOne();
    removeStoredFile(file.storedName);

    logActivity(req, {
      action: "deleted",
      entity: "File",
      entityId: file._id,
      message: `${req.leader.name} removed "${file.title}" from task "${task.title}"`,
    });

    return res.status(200).json({ message: "Attachment removed" });
  } catch (err) {
    console.error("leader removeTaskAttachment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
