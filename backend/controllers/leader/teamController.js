import mongoose from "mongoose";

import User from "../../models/User.js";
import Task from "../../models/Task.js";
import Project from "../../models/Project.js";
import Issue from "../../models/Issue.js";
import WorkLog from "../../models/WorkLog.js";
import Attendance from "../../models/Attendance.js";
import { getScope } from "../../middleware/leaderAuth.js";

const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * Ids an aggregation pipeline will actually match.
 *
 * `find()` casts query values against the schema; `aggregate()` does not. A
 * `$match` on `{ $in: ["6aa2…"] }` against an ObjectId field matches nothing
 * and reports it as zero rows rather than as an error — and getScope hands
 * `teamIds` back as strings, which is why every per-person figure on these
 * two screens has been coming back empty.
 */
const asObjectIds = (ids = []) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Live workload next to each member so the list is actionable on its own
    const taskRows = await Task.aggregate([
      { $match: { assignedTo: { $in: asObjectIds(ids) } } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          open: {
            $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] },
          },
          inReview: { $sum: { $cond: [{ $eq: ["$status", "review"] }, 1, 0] } },
          // What is already late, so the list says who needs chasing
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$status", "completed"] },
                    { $ne: ["$dueDate", null] },
                    { $lt: ["$dueDate", startOfToday] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const statsById = taskRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const items = members.map((member) => {
      const stats = statsById[String(member._id)] || {
        total: 0,
        completed: 0,
        open: 0,
        inReview: 0,
        overdue: 0,
      };
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
        tasksInReview: stats.inReview || 0,
        tasksOverdue: stats.overdue || 0,
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
        { $match: { assignedTo: { $in: asObjectIds(teamIds) } } },
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
        { $match: { employee: { $in: asObjectIds(teamIds) }, date: { $gte: monthStart } } },
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
            assignedTo: { $in: asObjectIds(teamIds) },
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

/* --------------------------------------------------------- one person */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * GET /api/leader/team/:id
 *
 * Everything a manager needs about one of their people, on one screen: what
 * they are carrying, what they have finished, which projects it is spread
 * across, how they have been rated and what they have been doing lately.
 *
 * Scoped to the manager's own team, and the id is checked against that scope
 * rather than trusted — somebody outside it reads as missing rather than as
 * refused, because there is nothing to learn from the difference.
 *
 * The payload deliberately carries no salary, no documents and no bank
 * details. A manager needs to know how somebody is doing, which is not the
 * same as needing their file — that stays with HR and the administrators.
 */
export const getTeamMember = async (req, res) => {
  try {
    const { teamIds, projectIds } = await getScope(req);

    if (!teamIds.some((id) => String(id) === String(req.params.id))) {
      return res.status(404).json({ message: "That person is not on your team" });
    }

    const member = await User.findById(req.params.id)
      .select("name email phone designation department status joiningDate reportsTo workLocation employmentType responsibilities")
      .populate("reportsTo", "name role")
      // Plain object, so the response carries the selected fields and nothing
      // a hydrated document would bring along with them
      .lean();

    if (!member) return res.status(404).json({ message: "That person is not on your team" });

    const me = new mongoose.Types.ObjectId(String(member._id));

    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth() + 1}`, label: MONTH_LABELS[d.getMonth()] };
    });
    const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      byStatus,
      overdue,
      ratingRow,
      byProject,
      recentTasks,
      donePerMonth,
      attendanceRows,
      hoursRow,
      issuesRaised,
    ] = await Promise.all([
      Task.aggregate([
        { $match: { assignedTo: me } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Task.countDocuments({
        assignedTo: member._id,
        status: { $ne: "completed" },
        dueDate: { $lt: startOfToday },
      }),

      Task.aggregate([
        { $match: { assignedTo: me, status: "completed", reviewRating: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: "$reviewRating" }, count: { $sum: 1 } } },
      ]),

      // Where their work actually sits, project by project
      Task.aggregate([
        { $match: { assignedTo: me, project: { $ne: null } } },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            open: { $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] } },
            inReview: { $sum: { $cond: [{ $eq: ["$status", "review"] }, 1, 0] } },
          },
        },
      ]),

      Task.find({ assignedTo: member._id })
        .populate("project", "name code")
        .select("title status priority dueDate completedAt reviewRating progress project")
        .sort({ updatedAt: -1 })
        .limit(12),

      Task.aggregate([
        { $match: { assignedTo: me, status: "completed", completedAt: { $gte: since } } },
        {
          $group: {
            _id: { y: { $year: "$completedAt" }, m: { $month: "$completedAt" } },
            count: { $sum: 1 },
          },
        },
      ]),

      Attendance.aggregate([
        { $match: { employee: me, date: { $gte: monthStart } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      WorkLog.aggregate([
        { $match: { employee: me, date: { $gte: monthStart } } },
        { $group: { _id: null, hours: { $sum: "$hours" }, days: { $sum: 1 } } },
      ]),

      Issue.countDocuments({
        raisedBy: member._id,
        status: { $in: ["open", "in_progress"] },
      }),
    ]);

    const status = byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
    const total = Object.values(status).reduce((sum, n) => sum + n, 0);
    const completed = status.completed || 0;

    const attendance = attendanceRows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
    const attendanceDays = Object.values(attendance).reduce((sum, n) => sum + n, 0);

    /**
     * The projects this person is on, named.
     *
     * Only the ones the manager already reaches: somebody may also be on
     * another manager's project, and how they are doing over there is that
     * manager's to see.
     */
    const mineOnly = byProject.filter((row) =>
      projectIds.some((id) => String(id) === String(row._id))
    );

    const projects = await Project.find({ _id: { $in: mineOnly.map((row) => row._id) } })
      .select("name code status progress endDate")
      .lean();

    const projectById = projects.reduce((acc, p) => ({ ...acc, [String(p._id)]: p }), {});

    const monthMap = donePerMonth.reduce(
      (acc, row) => ({ ...acc, [`${row._id.y}-${row._id.m}`]: row.count }),
      {}
    );

    return res.status(200).json({
      member,

      stats: {
        tasksTotal: total,
        tasksCompleted: completed,
        tasksOpen: (status.pending || 0) + (status.in_progress || 0),
        tasksNotStarted: status.pending || 0,
        tasksInProgress: status.in_progress || 0,
        tasksInReview: status.review || 0,
        overdue,
        completionRate: rate(completed, total),
        avgRating: Number((ratingRow[0]?.avg || 0).toFixed(1)),
        ratedTasks: ratingRow[0]?.count || 0,
        projects: mineOnly.length,
        issuesRaised,
        hoursThisMonth: Math.round((hoursRow[0]?.hours || 0) * 10) / 10,
        daysLogged: hoursRow[0]?.days || 0,
        attendanceRate: rate(attendance.present || 0, attendanceDays),
        attendanceDays,
      },

      projects: mineOnly
        .map((row) => ({
          ...(projectById[String(row._id)] || {}),
          _id: row._id,
          total: row.total,
          completed: row.completed,
          open: row.open,
          inReview: row.inReview,
        }))
        .sort((a, b) => b.open - a.open || b.total - a.total),

      recentTasks,

      monthlyTrend: buckets.map((b) => ({ month: b.label, tasksCompleted: monthMap[b.key] || 0 })),

      attendanceThisMonth: attendance,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person is not on your team" });
    }
    console.error("leader getTeamMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
