import User from "../../models/User.js";
import Task from "../../models/Task.js";
import Attendance from "../../models/Attendance.js";
import { getScope } from "../../middleware/leaderAuth.js";

const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// GET /api/leader/team
export const listTeam = async (req, res) => {
  try {
    const { teamIds } = await getScope(req);

    const search = (req.query.search || "").trim();
    const query = { _id: { $in: teamIds } };

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }, { designation: regex }];
    }
    if (req.query.status && req.query.status !== "all") {
      query.status = req.query.status;
    }

    const members = await User.find(query).select("-password").sort({ name: 1 });
    const ids = members.map((m) => m._id);

    // Live workload next to each member so the list is actionable on its own
    const taskRows = await Task.aggregate([
      { $match: { assignedTo: { $in: ids } } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          open: {
            $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] },
          },
        },
      },
    ]);

    const statsById = taskRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const items = members.map((member) => {
      const stats = statsById[String(member._id)] || { total: 0, completed: 0, open: 0 };
      return {
        _id: member._id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        designation: member.designation,
        department: member.department,
        status: member.status,
        joiningDate: member.joiningDate,
        tasks: stats.total,
        tasksCompleted: stats.completed,
        tasksOpen: stats.open,
        completionRate: rate(stats.completed, stats.total),
      };
    });

    return res.status(200).json({ items, total: items.length, page: 1, pages: 1 });
  } catch (err) {
    console.error("leader listTeam error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/leader/team/performance
export const teamPerformance = async (req, res) => {
  try {
    const { teamIds } = await getScope(req);

    const members = await User.find({ _id: { $in: teamIds } })
      .select("name email designation department status")
      .sort({ name: 1 });

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [taskRows, attendanceRows, overdueRows] = await Promise.all([
      Task.aggregate([
        { $match: { assignedTo: { $in: teamIds } } },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            pending: {
              $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] },
            },
            inReview: { $sum: { $cond: [{ $eq: ["$status", "review"] }, 1, 0] } },
            avgRating: { $avg: "$reviewRating" },
          },
        },
      ]),
      Attendance.aggregate([
        { $match: { employee: { $in: teamIds }, date: { $gte: monthStart } } },
        {
          $group: {
            _id: "$employee",
            days: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
          },
        },
      ]),
      Task.aggregate([
        {
          $match: {
            assignedTo: { $in: teamIds },
            status: { $ne: "completed" },
            dueDate: { $lt: startOfToday },
          },
        },
        { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
      ]),
    ]);

    const taskStats = taskRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});
    const attStats = attendanceRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});
    const overdueStats = overdueRows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r.count }), {});

    const items = members.map((member) => {
      const key = String(member._id);
      const t = taskStats[key] || { total: 0, completed: 0, pending: 0, inReview: 0, avgRating: 0 };
      const a = attStats[key] || { days: 0, present: 0 };

      const completion = rate(t.completed, t.total);
      const attendance = rate(a.present, a.days);

      return {
        id: member._id,
        name: member.name,
        email: member.email,
        designation: member.designation,
        department: member.department,
        status: member.status,
        tasks: t.total,
        tasksCompleted: t.completed,
        tasksPending: t.pending,
        tasksInReview: t.inReview,
        overdue: overdueStats[key] || 0,
        completionRate: completion,
        attendanceRate: attendance,
        rating: Number((t.avgRating || 0).toFixed(1)),
        score: Math.round((completion + attendance) / 2),
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("leader teamPerformance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
