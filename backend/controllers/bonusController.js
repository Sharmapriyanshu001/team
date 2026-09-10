import Task from "../models/Task.js";
import Project from "../models/Project.js";

/**
 * Task bonuses: who earned what, on which piece of work.
 *
 * Deliberately a separate report from the incentive scheme in
 * utils/incentive.js, and it is worth being clear about the difference,
 * because both are called "bonus" in conversation.
 *
 *   incentive scheme   scores a whole month in points against deadlines and
 *                      pays a slab. It is about a person's month.
 *   task bonus         an amount put on one job — "there is ₹2,000 on this if
 *                      it lands". It is about a piece of work.
 *
 * A month can produce both. Folding them into one figure would mean neither
 * could be explained to the person receiving it, which is the fastest way to
 * make a scheme resented.
 *
 * WHEN IT COUNTS
 *
 * The date comes from Task.bonusAwardedAt, which the Task model stamps when
 * the status reaches completed and clears when it leaves — see the hook there.
 * So this report cannot include work that was sent back for rework, and cannot
 * miss work that was completed through a route nobody remembered to update.
 */

/** Who is asking, and which tasks that lets them count. */
const audienceOf = async (req) => {
  if (req.admin) {
    return { kind: "admin", actor: req.admin, filter: {}, seesEverybody: true };
  }

  if (req.leader) {
    const { getScope } = await import("../middleware/leaderAuth.js");
    const { projectIds, teamIds } = await getScope(req);
    return {
      kind: "leader",
      actor: req.leader,
      /**
       * Their projects' work, their people's work, and anything they handed
       * out themselves — the last because a leader who assigned a task with
       * money on it has to be able to see whether it was earned, even if the
       * project moved elsewhere afterwards.
       */
      filter: {
        $or: [
          { project: { $in: projectIds } },
          { assignedTo: { $in: teamIds || [] } },
          { assignedBy: req.leader._id },
        ],
      },
      seesEverybody: false,
    };
  }

  if (req.employee) {
    return {
      kind: "employee",
      actor: req.employee,
      filter: { assignedTo: req.employee._id },
      seesEverybody: false,
    };
  }

  return null;
};

/** "2026-09" → the month it names. Blank means every month. */
const periodRange = (period) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  };
};

/**
 * GET .../bonuses?period=YYYY-MM
 *
 * The rows, and the totals a payroll run is read off. Grouped by person for
 * the admin and the leader, because "who is being paid what" is the question;
 * an employee gets their own rows and no grouping, because there is only them.
 */
export const listBonuses = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience) return res.status(401).json({ message: "Not authorized" });

    const filters = [audience.filter, { bonus: { $gt: 0 } }];

    /**
     * Awarded work only, unless somebody asks for the pipeline too. The
     * default is the money that is owed; "pending" is the money that might be.
     */
    const view = String(req.query.view || "earned");
    if (view === "earned") filters.push({ bonusAwardedAt: { $ne: null } });
    if (view === "pending") filters.push({ bonusAwardedAt: null });

    const range = periodRange(req.query.period);
    if (range && view !== "pending") {
      filters.push({ bonusAwardedAt: { $gte: range.from, $lte: range.to } });
    }

    if (req.query.employee && req.query.employee !== "all") {
      filters.push({ assignedTo: req.query.employee });
    }
    if (req.query.project && req.query.project !== "all") {
      filters.push({ project: req.query.project });
    }

    const query = { $and: filters };

    const tasks = await Task.find(query)
      .select("title bonus bonusAwardedAt status completedAt dueDate project assignedTo")
      .populate("assignedTo", "name email designation role")
      .populate("project", "name code")
      .sort({ bonusAwardedAt: -1, completedAt: -1 })
      .limit(500);

    const items = tasks.map((task) => ({
      _id: task._id,
      title: task.title,
      bonus: task.bonus,
      awardedAt: task.bonusAwardedAt || null,
      earned: Boolean(task.bonusAwardedAt),
      status: task.status,
      completedAt: task.completedAt || null,
      dueDate: task.dueDate || null,
      /**
       * Whether it landed on time. The bonus is paid either way — it was
       * promised for the job, not for the date — but a manager reading this
       * list wants to know, and it costs one comparison to say.
       */
      onTime:
        task.dueDate && task.completedAt
          ? new Date(task.completedAt) <= new Date(task.dueDate)
          : null,
      project: task.project,
      employee: task.assignedTo,
    }));

    /**
     * Per person, which is the shape a payment run needs. An unassigned task
     * carrying a bonus is a real row — somebody put money on work nobody
     * holds — and it is grouped under a null id rather than dropped, because
     * dropping it is how the totals stop adding up.
     */
    const byPerson = new Map();
    items.forEach((row) => {
      const key = String(row.employee?._id || "unassigned");
      if (!byPerson.has(key)) {
        byPerson.set(key, {
          employee: row.employee || null,
          tasks: 0,
          amount: 0,
          earned: 0,
          pending: 0,
        });
      }
      const entry = byPerson.get(key);
      entry.tasks += 1;
      entry.amount += row.bonus;
      if (row.earned) entry.earned += row.bonus;
      else entry.pending += row.bonus;
    });

    const people = [...byPerson.values()].sort((a, b) => b.earned - a.earned || b.amount - a.amount);

    const totals = items.reduce(
      (acc, row) => ({
        tasks: acc.tasks + 1,
        amount: acc.amount + row.bonus,
        earned: acc.earned + (row.earned ? row.bonus : 0),
        pending: acc.pending + (row.earned ? 0 : row.bonus),
      }),
      { tasks: 0, amount: 0, earned: 0, pending: 0 }
    );

    return res.status(200).json({
      items,
      people: audience.kind === "employee" ? [] : people,
      totals: { ...totals, people: people.length },
      period: req.query.period || "",
      view,
      audience: audience.kind,
    });
  } catch (err) {
    console.error("listBonuses error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET .../bonuses/projects
 *
 * The bonus a project is carrying, which is a cost on it. Admin and leader
 * only — an employee has no reason to read what everybody else's tasks are
 * worth, and the route is not mounted in their panel.
 */
export const bonusByProject = async (req, res) => {
  try {
    const audience = await audienceOf(req);
    if (!audience || audience.kind === "employee") {
      return res.status(403).json({ message: "Not available" });
    }

    const rows = await Task.aggregate([
      { $match: { $and: [audience.filter, { bonus: { $gt: 0 }, project: { $ne: null } }] } },
      {
        $group: {
          _id: "$project",
          tasks: { $sum: 1 },
          amount: { $sum: "$bonus" },
          earned: {
            $sum: { $cond: [{ $ne: ["$bonusAwardedAt", null] }, "$bonus", 0] },
          },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 200 },
    ]);

    const projects = await Project.find({ _id: { $in: rows.map((r) => r._id) } }).select(
      "name code status"
    );
    const byId = projects.reduce((acc, p) => ({ ...acc, [String(p._id)]: p }), {});

    return res.status(200).json({
      items: rows.map((row) => ({
        project: byId[String(row._id)] || null,
        tasks: row.tasks,
        amount: row.amount,
        earned: row.earned,
        pending: row.amount - row.earned,
      })),
    });
  } catch (err) {
    console.error("bonusByProject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
