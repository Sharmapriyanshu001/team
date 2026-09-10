import Task, { TASK_STATUS } from "../../models/Task.js";
import User, { SALES_ADMIN_ROLE } from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import { teamFilterFor } from "../../utils/salesAccess.js";

/**
 * The work a sales manager hands to their own team.
 *
 * Sales had a pipeline but no way to say "call these forty leads back by
 * Friday" — anything that was not a lead, a quotation or a client lived in a
 * WhatsApp message. This is that missing half: a manager writes the task
 * against a person and a date, the person sees it on their own screen, and
 * both of them are reading the same record a week later.
 *
 * Deliberately the same Task collection every other panel uses rather than a
 * sales-only copy. A task is a task; a second model would mean a second set of
 * statuses that drift, a second overdue rule, and reports that disagree. Sales
 * tasks carry no project and no team — the Task model already allows that,
 * which is what `team` was added for — so they do not surface in a team
 * leader's project lists. What identifies one is who it is between.
 *
 * WHO MAY DO WHAT
 *
 *   manager    creates, edits, reassigns, deletes; sees everything they
 *              handed out and everything sitting on their team
 *   executive  sees what was assigned to them, and may move the status
 *
 * The executive's edit is narrow on purpose. Somebody who could rewrite the
 * task they were given could quietly change what they were asked to do, and
 * the point of writing work down is that both sides can still read the same
 * sentence afterwards. Status is the one field that is theirs to move.
 */

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isManager = (user) => user?.role === SALES_ADMIN_ROLE;

const withRefs = (query) =>
  query.populate("assignedTo", "name email role").populate("assignedBy", "name email role");

/**
 * The people this manager may hand work to — their own reports, and
 * themselves.
 *
 * Resolved from the database on every write rather than trusted from the
 * request. The dropdown is built from the same filter, but a dropdown is a
 * suggestion and this is the check. Without it a manager could drop work onto
 * another manager's executive by posting their id, which is exactly what a
 * reporting line exists to prevent.
 */
const teamIdsFor = async (manager) => {
  const members = await User.find(teamFilterFor(manager)).select("_id");
  return members.map((m) => m._id);
};

/** Midnight in the server's timezone, for the due-date filters. */
const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * May this account see this task at all?
 *
 * A 404 rather than a 403 wherever this says no, for the same reason the lead
 * scope does it: telling somebody a task exists but is not theirs is how a
 * sales floor reads the shape of a colleague's week one refusal at a time.
 */
const canTouch = async (user, task) => {
  const assignee = String(task.assignedTo?._id || task.assignedTo || "");
  if (assignee === String(user._id)) return true;
  if (!isManager(user)) return false;

  if (String(task.assignedBy?._id || task.assignedBy || "") === String(user._id)) return true;

  const ids = await teamIdsFor(user);
  return ids.some((id) => String(id) === assignee);
};

/* ----------------------------------------------------------------- list */

/**
 * GET /api/sales/tasks
 *
 * A manager's list and an executive's list are the same screen asking two
 * different questions, so this is one handler with one scope clause rather
 * than two endpoints that have to be kept saying the same thing.
 */
export const listTasks = async (req, res) => {
  try {
    const mine = { assignedTo: req.sales._id };

    /**
     * A manager sees the work they handed out and anything sitting on one of
     * their people. The second half matters: a task the administrator gave
     * directly to a sales executive is still that manager's business.
     */
    const scope = isManager(req.sales)
      ? {
          $or: [
            { assignedBy: req.sales._id },
            { assignedTo: { $in: await teamIdsFor(req.sales) } },
          ],
        }
      : mine;

    const filters = [scope];

    // "My tasks" for a manager, who is also somebody's assignee
    if (req.query.view === "mine") filters.push(mine);

    if (req.query.status && req.query.status !== "all") {
      filters.push({ status: req.query.status });
    }
    if (req.query.view === "open") {
      filters.push({ status: { $in: ["pending", "in_progress"] } });
    }
    if (req.query.priority && req.query.priority !== "all") {
      filters.push({ priority: req.query.priority });
    }
    if (req.query.assignedTo && req.query.assignedTo !== "all") {
      filters.push({ assignedTo: req.query.assignedTo });
    }

    if (req.query.due === "today") {
      const today = dayStart();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      filters.push({ dueDate: { $gte: today, $lt: tomorrow } });
    }
    if (req.query.due === "overdue") {
      filters.push({ dueDate: { $lt: dayStart() }, status: { $ne: "completed" } });
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      /**
       * Pushed as its own clause rather than assigned onto the query. The
       * scope above is an $or, and a second $or would replace it — turning a
       * search into a list of everybody's tasks.
       */
      filters.push({ $or: [{ title: regex }, { description: regex }] });
    }

    const query = { $and: filters };

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 25);

    const [items, total, open, overdue, done] = await Promise.all([
      withRefs(Task.find(query))
        .sort({ dueDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Task.countDocuments(query),
      /**
       * The tiles count the whole scope rather than the filtered page. Counted
       * off the filters, "overdue" reads zero the moment somebody filters to
       * completed, which is the one number that must not quietly go quiet.
       */
      Task.countDocuments({ $and: [scope, { status: { $in: ["pending", "in_progress"] } }] }),
      Task.countDocuments({
        $and: [scope, { dueDate: { $lt: dayStart() }, status: { $ne: "completed" } }],
      }),
      Task.countDocuments({ $and: [scope, { status: "completed" }] }),
    ]);

    return res.status(200).json({
      items,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      counts: { open, overdue, completed: done },
      canAssign: isManager(req.sales),
    });
  } catch (err) {
    console.error("sales listTasks error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- the dot */

// GET /api/sales/tasks/new-count
export const countNewTasks = async (req, res) => {
  try {
    const count = await Task.countDocuments({
      assignedTo: req.sales._id,
      seenByAssignee: false,
    });
    return res.status(200).json({ count });
  } catch (err) {
    console.error("sales countNewTasks error:", err);
    // A dot that failed to load should read as "nothing new", never as an error
    return res.status(200).json({ count: 0 });
  }
};

// PUT /api/sales/tasks/seen — clears the dot once they have looked
export const markTasksSeen = async (req, res) => {
  try {
    await Task.updateMany(
      { assignedTo: req.sales._id, seenByAssignee: false },
      { $set: { seenByAssignee: true } }
    );
    return res.status(200).json({ count: 0 });
  } catch (err) {
    console.error("sales markTasksSeen error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* -------------------------------------------------------------- get one */

// GET /api/sales/tasks/:id
export const getTask = async (req, res) => {
  try {
    const task = await withRefs(Task.findById(req.params.id));
    if (!task) return res.status(404).json({ message: "That task was not found" });

    if (!(await canTouch(req.sales, task))) {
      return res.status(404).json({ message: "That task was not found" });
    }

    return res.status(200).json({ item: task, canEdit: isManager(req.sales) });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That task was not found" });
    }
    console.error("sales getTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- create */

/**
 * POST /api/sales/tasks
 *
 * Manager only, and the assignee has to be one of theirs. Both checks earn
 * their place: the route guard says who may create a task at all, the team
 * lookup says whose name may go on it.
 */
export const createTask = async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ message: "Give the task a title" });

    const assignedTo = String(req.body.assignedTo || "").trim();
    if (!assignedTo) return res.status(400).json({ message: "Choose who this is for" });

    const ids = await teamIdsFor(req.sales);
    if (!ids.some((id) => String(id) === assignedTo)) {
      return res
        .status(400)
        .json({ message: "You can only assign work to somebody on your own team" });
    }

    const status = TASK_STATUS.includes(req.body.status) ? req.body.status : "pending";
    const priority = ["low", "medium", "high"].includes(req.body.priority)
      ? req.body.priority
      : "medium";

    const task = await Task.create({
      title,
      description: String(req.body.description || "").trim(),
      assignedTo,
      assignedBy: req.sales._id,
      status,
      priority,
      dueDate: req.body.dueDate || undefined,
      // Lights the dot on their sidebar until they open the list
      seenByAssignee: false,
    });

    logActivity(req, {
      action: "created",
      entity: "Sales task",
      entityId: task._id,
      message: `Task "${task.title}" assigned`,
    });

    /**
     * Assigning work to yourself is ordinary — a manager keeps a list too.
     * Telling yourself about it is not, so the notification is skipped rather
     * than the assignment refused.
     */
    if (assignedTo !== String(req.sales._id)) {
      notifyUser(assignedTo, {
        type: "task",
        title: "New task assigned",
        message: `${req.sales.name} assigned you "${task.title}"`,
        link: "/sales/tasks",
      });
    }

    return res.status(201).json({
      message: "Task assigned",
      item: await withRefs(Task.findById(task._id)),
    });
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    if (err.name === "CastError") {
      return res.status(400).json({ message: "That is not somebody on your team" });
    }
    console.error("sales createTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- update */

/**
 * PUT /api/sales/tasks/:id
 *
 * Two different edits behind one route. A manager may change anything on a
 * task of theirs, including whose it is. An assignee may move the status and
 * nothing else — every other field in the body is ignored rather than
 * refused, so an executive pressing "Mark done" on a form that also carries
 * the title gets their status change instead of an error about the title.
 */
export const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "That task was not found" });

    if (!(await canTouch(req.sales, task))) {
      return res.status(404).json({ message: "That task was not found" });
    }

    const wasStatus = task.status;

    if (req.body.status !== undefined) {
      if (!TASK_STATUS.includes(req.body.status)) {
        return res.status(400).json({ message: "That is not a task status" });
      }
      task.status = req.body.status;
    }

    if (isManager(req.sales)) {
      if (req.body.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title) return res.status(400).json({ message: "Give the task a title" });
        task.title = title;
      }
      if (req.body.description !== undefined) {
        task.description = String(req.body.description).trim();
      }
      if (req.body.priority !== undefined) {
        if (!["low", "medium", "high"].includes(req.body.priority)) {
          return res.status(400).json({ message: "That is not a priority" });
        }
        task.priority = req.body.priority;
      }
      if (req.body.dueDate !== undefined) {
        task.dueDate = req.body.dueDate || undefined;
      }

      /**
       * Reassignment. The new person has to be on this manager's team too —
       * without that the check on create would be worth nothing, since anyone
       * could create a task against themselves and then hand it anywhere.
       */
      if (req.body.assignedTo !== undefined) {
        const next = String(req.body.assignedTo).trim();

        if (next && next !== String(task.assignedTo || "")) {
          const ids = await teamIdsFor(req.sales);
          if (!ids.some((id) => String(id) === next)) {
            return res
              .status(400)
              .json({ message: "You can only assign work to somebody on your own team" });
          }
          task.assignedTo = next;
          // New owner, new dot — they have not seen this one yet
          task.seenByAssignee = false;

          if (next !== String(req.sales._id)) {
            notifyUser(next, {
              type: "task",
              title: "A task was passed to you",
              message: `${req.sales.name} assigned you "${task.title}"`,
              link: "/sales/tasks",
            });
          }
        }
      }
    }

    await task.save();

    logActivity(req, {
      action: "updated",
      entity: "Sales task",
      entityId: task._id,
      message: `Task "${task.title}" updated`,
    });

    /**
     * The manager hears back when work they handed out finishes. Only on the
     * change into "completed", so re-saving a done task does not tell them a
     * second time, and never when they completed it themselves.
     */
    if (
      task.status === "completed" &&
      wasStatus !== "completed" &&
      task.assignedBy &&
      String(task.assignedBy) !== String(req.sales._id)
    ) {
      notifyUser(task.assignedBy, {
        type: "task",
        title: "Task completed",
        message: `${req.sales.name} completed "${task.title}"`,
        link: "/sales/tasks",
      });
    }

    return res.status(200).json({
      message: "Task updated",
      item: await withRefs(Task.findById(task._id)),
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That task was not found" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    console.error("sales updateTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------- delete */

// DELETE /api/sales/tasks/:id — manager only, enforced by the route guard
export const removeTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "That task was not found" });

    if (!(await canTouch(req.sales, task))) {
      return res.status(404).json({ message: "That task was not found" });
    }

    await task.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Sales task",
      entityId: task._id,
      message: `Task "${task.title}" deleted`,
    });

    return res.status(200).json({ message: "Task deleted" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That task was not found" });
    }
    console.error("sales removeTask error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
