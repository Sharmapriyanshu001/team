import User from "../models/User.js";
import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import FileDoc from "../models/FileDoc.js";
import Attendance from "../models/Attendance.js";
import Leave from "../models/Leave.js";
import { comparePassword } from "../utils/password.js";
import {
  countByStatus,
  monthStart,
  projectFields,
  projectRollup,
  sumCounts,
  taskRollup,
  yearStart,
} from "../utils/staffRollup.js";

/**
 * The stored password is a one-way scrypt hash, so it can never be read back.
 * What we can do is test it against the default this panel hands out — the
 * person's mobile number. If it still matches, the admin sees the real login
 * password; otherwise a custom one was typed in and only a reset recovers it.
 */
const readCredentials = (record, portal) => {
  const phone = (record.phone || "").trim();
  const hasPassword = Boolean(record.password);
  const isDefault = hasPassword && Boolean(phone) && comparePassword(phone, record.password);

  return {
    loginId: record.email,
    password: isDefault ? phone : null,
    isDefault,
    hasPassword,
    portal,
  };
};

/* --------------------------------------------------------- operations manager */

const leaderExtras = async (leader) => {
  const [projects, team] = await Promise.all([
    Project.find({ operationsManager: leader._id })
      .select(`${projectFields} client`)
      .populate("client", "name company")
      .sort({ createdAt: -1 }),
    User.find({ reportsTo: leader._id })
      .select("name email phone designation department status")
      .sort({ name: 1 }),
  ]);

  const tasks = await taskRollup({ project: { $in: projects.map((p) => p._id) } });

  return {
    projects,
    team,
    tasks: [],
    files: [],
    stats: { ...projectRollup(projects), ...tasks, teamSize: team.length },
  };
};

/* ------------------------------------------------------------ employee */

const employeeExtras = async (employee) => {
  const [projects, tasks, taskStats, attendanceRows, leaveDays] = await Promise.all([
    Project.find({ members: employee._id })
      .select(`${projectFields} client`)
      .populate("client", "name company")
      .sort({ createdAt: -1 }),
    Task.find({ assignedTo: employee._id })
      /**
       * Everything the task card shows. It used to be five fields, from before
       * a task carried a progress figure, a start date or a bonus — so the
       * card could only ever draw a title and a status pill, whatever the task
       * actually held.
       */
      .select(
        "title status priority startDate dueDate completedAt progress bonus bonusAwardedAt project"
      )
      .populate("project", "name code")
      .sort({ createdAt: -1 })
      /**
       * Twenty rather than eight. Eight is barely a fortnight for somebody
       * working from a task board, and the card list is the only place their
       * recent work is visible at all.
       */
      .limit(20),
    taskRollup({ assignedTo: employee._id }),
    Attendance.aggregate([
      { $match: { employee: employee._id, date: { $gte: monthStart() } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    /**
     * Leave already taken this year, which the drawer shows beside the
     * attendance. Approved only — a request nobody has decided yet is not
     * time off, and counting it would have somebody's balance move when a
     * manager has not touched it.
     */
    Leave.aggregate([
      {
        $match: {
          employee: employee._id,
          status: "approved",
          fromDate: { $gte: yearStart() },
        },
      },
      { $group: { _id: null, days: { $sum: "$days" } } },
    ]),
  ]);

  const attendance = countByStatus(attendanceRows);

  return {
    projects,
    team: [],
    tasks,
    files: [],
    stats: {
      ...projectRollup(projects),
      ...taskStats,
      teamSize: 0,
      presentThisMonth: attendance.present || 0,
      markedThisMonth: sumCounts(attendance),
      leaveTakenThisYear: leaveDays[0]?.days || 0,
    },
  };
};

/**
 * GET /api/admin/operations-managers/:id/details
 * GET /api/admin/employees/:id/details
 *
 * Everything the profile drawer shows in one call: the person's record, the
 * login credentials to hand over, and their projects / team / tasks.
 */
export const staffDetails = (role) => async (req, res) => {
  const entity = role === "operations_manager" ? "Operations Manager" : "Employee";

  try {
    const user = await User.findOne({ _id: req.params.id, role }).populate(
      "reportsTo",
      "name email designation"
    );
    if (!user) return res.status(404).json({ message: `${entity} not found` });

    const credentials = readCredentials(
      user,
      role === "operations_manager" ? "Operations Manager portal" : "Employee portal"
    );
    const extras =
      role === "operations_manager" ? await leaderExtras(user) : await employeeExtras(user);

    const item = user.toObject();
    delete item.password;

    return res.status(200).json({ item, credentials, ...extras });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: `${entity} not found` });
    }
    console.error(`${entity} details error:`, err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/admin/clients/:id/details
 *
 * Same drawer for a client: portal login, their projects with the leader on
 * each, work in flight, open issues and the latest documents on file.
 */
export const clientDetails = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).populate(
      "previousProject",
      "name code status endDate"
    );
    if (!client) return res.status(404).json({ message: "Client not found" });

    const projects = await Project.find({ client: client._id })
      .select(`${projectFields} operationsManager previousProject`)
      .populate("operationsManager", "name designation")
      .populate("previousProject", "name code")
      .sort({ createdAt: -1 });

    const projectIds = projects.map((p) => p._id);

    const [tasks, openIssues, files, fileCount] = await Promise.all([
      taskRollup({ project: { $in: projectIds } }),
      Issue.countDocuments({
        project: { $in: projectIds },
        status: { $in: ["open", "in_progress"] },
      }),
      FileDoc.find({ client: client._id })
        .select("title category fileType createdAt project")
        .populate("project", "name code")
        .sort({ createdAt: -1 })
        .limit(6),
      FileDoc.countDocuments({ client: client._id }),
    ]);

    const item = client.toObject();
    delete item.password;

    return res.status(200).json({
      item,
      credentials: readCredentials(client, "Client portal"),
      projects,
      team: [],
      tasks: [],
      files,
      stats: {
        ...projectRollup(projects),
        ...tasks,
        teamSize: 0,
        openIssues,
        files: fileCount,
        budget: projects.reduce((sum, p) => sum + (p.budget || 0), 0),
      },
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Client not found" });
    }
    console.error("Client details error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
