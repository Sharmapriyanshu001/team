import User from "../models/User.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Attendance from "../models/Attendance.js";

const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

const groupCount = (rows, idKey = "_id") =>
  rows.reduce((acc, row) => {
    acc[String(row[idKey])] = row.count;
    return acc;
  }, {});

// GET /api/admin/team-leaders/performance
export const teamLeaderPerformance = async (req, res) => {
  try {
    const leaders = await User.find({ role: "team_leader" })
      .select("name email designation department status")
      .sort({ name: 1 });

    const leaderIds = leaders.map((l) => l._id);

    const [projectRows, teamRows, projects] = await Promise.all([
      Project.aggregate([
        { $match: { teamLeader: { $in: leaderIds } } },
        {
          $group: {
            _id: "$teamLeader",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            avgProgress: { $avg: "$progress" },
          },
        },
      ]),
      User.aggregate([
        { $match: { reportsTo: { $in: leaderIds } } },
        { $group: { _id: "$reportsTo", count: { $sum: 1 } } },
      ]),
      Project.find({ teamLeader: { $in: leaderIds } }).select("_id teamLeader"),
    ]);

    // Tasks belonging to each leader's projects
    const projectIds = projects.map((p) => p._id);
    const taskRows = await Task.aggregate([
      { $match: { project: { $in: projectIds } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
        },
      },
    ]);

    const tasksByProject = taskRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const taskTotalsByLeader = {};
    projects.forEach((p) => {
      const leaderKey = String(p.teamLeader);
      const row = tasksByProject[String(p._id)] || { total: 0, completed: 0 };
      const current = taskTotalsByLeader[leaderKey] || { total: 0, completed: 0 };
      taskTotalsByLeader[leaderKey] = {
        total: current.total + row.total,
        completed: current.completed + row.completed,
      };
    });

    const projectStats = projectRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});
    const teamSize = groupCount(teamRows);

    const items = leaders.map((leader) => {
      const key = String(leader._id);
      const p = projectStats[key] || { total: 0, completed: 0, avgProgress: 0 };
      const t = taskTotalsByLeader[key] || { total: 0, completed: 0 };

      return {
        id: leader._id,
        name: leader.name,
        email: leader.email,
        designation: leader.designation,
        department: leader.department,
        status: leader.status,
        teamSize: teamSize[key] || 0,
        projects: p.total,
        projectsCompleted: p.completed,
        avgProgress: Math.round(p.avgProgress || 0),
        tasks: t.total,
        tasksCompleted: t.completed,
        taskCompletionRate: rate(t.completed, t.total),
        score: Math.round(
          (rate(p.completed, p.total) + rate(t.completed, t.total)) / 2
        ),
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("teamLeaderPerformance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/employees/performance
export const employeePerformance = async (req, res) => {
  try {
    const employees = await User.find({ role: "employee" })
      .select("name email designation department status reportsTo")
      .populate("reportsTo", "name")
      .sort({ name: 1 });

    const ids = employees.map((e) => e._id);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [taskRows, attendanceRows] = await Promise.all([
      Task.aggregate([
        { $match: { assignedTo: { $in: ids } } },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            pending: {
              $sum: {
                $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0],
              },
            },
            avgRating: { $avg: "$reviewRating" },
          },
        },
      ]),
      Attendance.aggregate([
        { $match: { employee: { $in: ids }, date: { $gte: monthStart } } },
        {
          $group: {
            _id: "$employee",
            days: { $sum: 1 },
            present: {
              $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const taskStats = taskRows.reduce((acc, r) => {
      acc[String(r._id)] = r;
      return acc;
    }, {});
    const attStats = attendanceRows.reduce((acc, r) => {
      acc[String(r._id)] = r;
      return acc;
    }, {});

    const items = employees.map((emp) => {
      const key = String(emp._id);
      const t = taskStats[key] || { total: 0, completed: 0, pending: 0, avgRating: 0 };
      const a = attStats[key] || { days: 0, present: 0 };
      const completion = rate(t.completed, t.total);
      const attendance = rate(a.present, a.days);

      return {
        id: emp._id,
        name: emp.name,
        email: emp.email,
        designation: emp.designation,
        department: emp.department,
        status: emp.status,
        teamLeader: emp.reportsTo?.name || "-",
        tasks: t.total,
        tasksCompleted: t.completed,
        tasksPending: t.pending,
        completionRate: completion,
        attendanceRate: attendance,
        rating: Number((t.avgRating || 0).toFixed(1)),
        score: Math.round((completion + attendance) / 2),
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("employeePerformance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
