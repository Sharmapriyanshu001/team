import Task from "../models/Task.js";
import FileDoc from "../models/FileDoc.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { notifyUser } from "../utils/notify.js";
import { copyStoredFile, removeStoredFile } from "../utils/uploads.js";

/**
 * "Assign work" from the Files panel: one brief handed to any number of team
 * leaders and employees at once, with an optional ZIP travelling alongside it.
 *
 * Each person gets their own Task, and — when an archive is attached — their
 * own file record with its own copy on disk. Nothing here is shared between
 * assignees, so one person completing or deleting their copy leaves everybody
 * else's hand-over untouched, and every existing screen keeps working because
 * the records look exactly like singly-assigned ones.
 */

const panelLink = (role) =>
  role === "team_leader" ? "/team-leader/tasks/pending" : "/employee/tasks/pending";

const filesLink = (role) => (role === "team_leader" ? "/team-leader/files" : "/employee/files");

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * The assignee list survives a multipart round trip as a JSON string, but a
 * plain JSON request sends it as an array. Accept both.
 */
const parseAssignees = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// POST /api/admin/assign-work   (multipart/form-data; "file" is optional)
export const assignWork = async (req, res) => {
  // Anything that rejects the request has to take the temp archive with it —
  // but once a record points at those bytes, deleting them would strand it.
  let recorded = false;
  const discard = () => !recorded && req.file && removeStoredFile(req.file.filename);

  try {
    const { description, project, priority, dueDate, assignmentNote } = req.body;

    const title = (req.body.title || "").trim();
    if (!title) {
      discard();
      return res.status(400).json({ message: "Write what the work is" });
    }

    /* ------------------------------------------------------------ people */

    const requested = parseAssignees(req.body.assignees);
    if (!requested.length) {
      discard();
      return res.status(400).json({ message: "Pick at least one person this work goes to" });
    }

    // The same person picked twice is one hand-over, not two
    const wanted = new Map();
    for (const entry of requested) {
      const id = String(entry?.id || entry?._id || entry || "");
      if (id) wanted.set(id, entry?.role);
    }

    const people = await User.find({
      _id: { $in: [...wanted.keys()] },
      role: { $in: ["team_leader", "employee"] },
      status: "active",
    }).select("name email role");

    if (people.length !== wanted.size) {
      discard();
      return res.status(400).json({
        message: "One of the people you picked is no longer an active team leader or employee",
      });
    }

    /* -------------------------------------------------------- the details */

    if (project) {
      const exists = await Project.exists({ _id: project });
      if (!exists) {
        discard();
        return res.status(400).json({ message: "That project no longer exists" });
      }
    }

    // The date picker blocks past dates; this is the same rule on the server,
    // where a hand-edited request cannot get around it.
    let due;
    if (dueDate) {
      due = new Date(dueDate);
      if (Number.isNaN(due.getTime())) {
        discard();
        return res.status(400).json({ message: "That due date is not a valid date" });
      }
      if (due < startOfToday()) {
        discard();
        return res.status(400).json({ message: "The due date cannot be before today" });
      }
    }

    const note = (assignmentNote || "").trim();

    /* --------------------------------------------------------- hand it out */

    const tasks = await Task.insertMany(
      people.map((person) => ({
        title,
        description: (description || "").trim(),
        project: project || undefined,
        assignedTo: person._id,
        assignedBy: req.admin._id,
        status: "pending",
        priority: priority || "medium",
        dueDate: due,
        // This is exactly what the red dot on their sidebar reads
        seenByAssignee: false,
      }))
    );

    // Every assignee needs their own bytes, so the archive multer just stored
    // goes to the first person and the rest get copies of it.
    let archives = 0;
    if (req.file) {
      for (const [index, person] of people.entries()) {
        const storedName =
          index === 0 ? req.file.filename : copyStoredFile(req.file.filename);

        // A copy that could not be written must not become a dead record
        if (!storedName) continue;

        await FileDoc.create({
          title: req.file.originalname,
          description: note,
          category: "other",
          fileType: "zip",
          size: req.file.size,
          project: project || undefined,
          uploadedBy: req.admin._id,
          storedName,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          assignedTo: person._id,
          assignedRole: person.role,
          assignedBy: req.admin._id,
          assignedAt: new Date(),
          assignmentNote: note || `Attached to "${title}"`,
          status: "assigned",
        });
        archives += 1;
        // From here the original bytes belong to a record, not to the request
        if (index === 0) recorded = true;
      }
    }

    /* ------------------------------------------------------------- tell them */

    for (const person of people) {
      notifyUser(person._id, {
        type: "task",
        title: "New work assigned to you",
        message: `"${title}"${req.file ? ` · ${req.file.originalname} attached` : ""}`,
        link: panelLink(person.role),
      });

      if (archives) {
        notifyUser(person._id, {
          type: "task",
          title: "A file has been assigned to you",
          message: `"${req.file.originalname}"${note ? ` — ${note}` : ""}`,
          link: filesLink(person.role),
        });
      }
    }

    const names = people.map((person) => person.name).join(", ");

    logActivity(req, {
      action: "created",
      entity: "Task",
      entityId: tasks[0]?._id,
      message: `${req.admin.name} assigned "${title}" to ${names}${
        archives ? ` with ${req.file.originalname}` : ""
      }`,
    });

    return res.status(201).json({
      message: `Work assigned to ${people.length} ${people.length === 1 ? "person" : "people"}${
        archives ? ` with ${req.file.originalname}` : ""
      }`,
      assigned: people.length,
      archives,
      names,
    });
  } catch (err) {
    console.error("assignWork error:", err);
    discard();
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};
