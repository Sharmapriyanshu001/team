import Client from "../models/Client.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import Issue from "../models/Issue.js";
import User from "../models/User.js";

// GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getReports = async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getFullYear(), to.getMonth() - 5, 1);
    from.setHours(0, 0, 0, 0);

    const range = { $gte: from, $lte: to };

    const [
      projects,
      tasks,
      issues,
      clientProjectRows,
      workloadRows,
      budgetByStatus,
    ] = await Promise.all([
      Project.find({ createdAt: range })
        .populate("client", "name company")
        .populate("teamLeader", "name")
        .sort({ createdAt: -1 }),
      Task.aggregate([
        { $match: { createdAt: range } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Issue.aggregate([
        { $match: { createdAt: range } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Project.aggregate([
        { $match: { createdAt: range, client: { $ne: null } } },
        {
          $group: {
            _id: "$client",
            projects: { $sum: 1 },
            budget: { $sum: "$budget" },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
          },
        },
        { $sort: { projects: -1 } },
        { $limit: 10 },
      ]),
      Task.aggregate([
        { $match: { assignedTo: { $ne: null }, createdAt: range } },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
      Project.aggregate([
        { $match: { createdAt: range } },
        { $group: { _id: "$status", budget: { $sum: "$budget" }, count: { $sum: 1 } } },
      ]),
    ]);

    const clientIds = clientProjectRows.map((r) => r._id);
    const userIds = workloadRows.map((r) => r._id);

    const [clientDocs, userDocs] = await Promise.all([
      Client.find({ _id: { $in: clientIds } }).select("name company"),
      User.find({ _id: { $in: userIds } }).select("name designation"),
    ]);

    const clientById = clientDocs.reduce((acc, c) => {
      acc[String(c._id)] = c;
      return acc;
    }, {});
    const userById = userDocs.reduce((acc, u) => {
      acc[String(u._id)] = u;
      return acc;
    }, {});

    // Budget booked per month across the range
    const revenueByMonth = {};
    projects.forEach((p) => {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      revenueByMonth[key] = (revenueByMonth[key] || 0) + (p.budget || 0);
    });

    return res.status(200).json({
      range: { from, to },
      summary: {
        projects: projects.length,
        completedProjects: projects.filter((p) => p.status === "completed").length,
        totalBudget: projects.reduce((sum, p) => sum + (p.budget || 0), 0),
        tasks: tasks.reduce((sum, t) => sum + t.count, 0),
        issues: issues.reduce((sum, i) => sum + i.count, 0),
      },
      tasksByStatus: tasks.map((t) => ({ name: t._id, value: t.count })),
      issuesByStatus: issues.map((i) => ({ name: i._id, value: i.count })),
      budgetByStatus: budgetByStatus.map((b) => ({
        name: b._id,
        budget: b.budget,
        count: b.count,
      })),
      revenueByMonth: Object.entries(revenueByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, budget]) => ({ month, budget })),
      topClients: clientProjectRows.map((row) => ({
        id: row._id,
        name: clientById[String(row._id)]?.name || "Unknown",
        company: clientById[String(row._id)]?.company || "",
        projects: row.projects,
        completed: row.completed,
        budget: row.budget,
      })),
      workload: workloadRows.map((row) => ({
        id: row._id,
        name: userById[String(row._id)]?.name || "Unknown",
        designation: userById[String(row._id)]?.designation || "",
        total: row.total,
        completed: row.completed,
        pending: row.total - row.completed,
      })),
      projects: projects.slice(0, 50),
    });
  } catch (err) {
    console.error("getReports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
