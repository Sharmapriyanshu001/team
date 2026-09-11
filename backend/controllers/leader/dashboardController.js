import mongoose from "mongoose";

import User from "../../models/User.js";
import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import Issue from "../../models/Issue.js";
import Notification from "../../models/Notification.js";
import ChangeRequest from "../../models/ChangeRequest.js";
import CodeSubmission from "../../models/CodeSubmission.js";
import { getScope } from "../../middleware/leaderAuth.js";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const localYear = (field) => ({ $year: { date: field, timezone: TZ } });
const localMonth = (field) => ({ $month: { date: field, timezone: TZ } });

const monthBuckets = (count) => {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth() + 1}`, label: MONTH_LABELS[d.getMonth()], start: d };
  });
};

const countsToObject = (rows) =>
  rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});

/**
 * Ids an aggregation pipeline will actually match.
 *
 * `find()` casts query values against the schema, so a string id works there
 * and every `Task.find` below has always been fine. `aggregate()` does no
 * casting at all: a `$match` on `{ $in: ["6aa2…"] }` against ObjectId fields
 * matches nothing and reports it as zero rows rather than as an error.
 *
 * getScope hands back `teamIds` as strings — which is why the team workload
 * chart on this dashboard has been silently empty — and `projectIds` as
 * strings too whenever the account runs a department. Converted here rather
 * than in getScope, because plenty of callers compare those ids as strings
 * and would break the other way.
 */
const asObjectIds = (ids = []) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

// GET /api/leader/dashboard
export const getDashboard = async (req, res) => {
  try {
    const { projectIds, teamIds } = await getScope(req);
    const buckets = monthBuckets(6);
    const since = buckets[0].start;

    const inMyProjects = { project: { $in: projectIds } };
    // The same filter for pipelines, which do not cast — see asObjectIds
    const inMyProjectsAgg = { project: { $in: asObjectIds(projectIds) } };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    /** How far back the team activity feed looks. */
    const activitySince = new Date(startOfToday.getTime() - 14 * 86400000);

    const tomorrow = new Date(startOfToday);
    tomorrow.setDate(tomorrow.getDate() + 1);

    /**
     * This week, starting Monday.
     *
     * A manager's week is the unit they actually run — a six-month trend
     * belongs in Reports, where somebody has gone looking for it. Monday
     * rather than a rolling seven days, because "this week" is what a standup
     * means and a window that slides every day never matches it.
     */
    const weekStart = new Date(startOfToday);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

    const [
      projects,
      tasksByStatus,
      tasksDonePerMonth,
      openIssues,
      issuesBySeverity,
      teamMembers,
      workloadRows,
      pendingReviews,
      upcoming,
      notifications,
      overdueCount,
      dueTodayCount,
      projectTaskRows,
      weekCompleted,
      openChangeRequests,
      codeReviewQueue,
      oldestIssue,
      wasCompleted,
      wasSubmitted,
      wasRaised,
    ] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .sort({ endDate: 1 }),

      Task.aggregate([
        { $match: inMyProjectsAgg },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Task.aggregate([
        { $match: { ...inMyProjectsAgg, status: "completed", completedAt: { $gte: since } } },
        {
          $group: {
            _id: { y: localYear("$completedAt"), m: localMonth("$completedAt") },
            count: { $sum: 1 },
          },
        },
      ]),

      Issue.countDocuments({ ...inMyProjects, status: { $in: ["open", "in_progress"] } }),
      Issue.aggregate([
        { $match: inMyProjectsAgg },
        { $group: { _id: "$severity", count: { $sum: 1 } } },
      ]),

      User.find({ _id: { $in: teamIds } }).select("name designation status"),

      /**
       * Per person: what they have done, what they are holding, what is late,
       * and what is sitting with the manager.
       *
       * The last two are what turn a workload bar into something a manager can
       * act on. "Six people, four numbers each" answers "who needs me today",
       * which counting tasks alone never does.
       */
      Task.aggregate([
        { $match: { assignedTo: { $in: asObjectIds(teamIds) } } },
        {
          $group: {
            _id: "$assignedTo",
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            pending: {
              $sum: { $cond: [{ $in: ["$status", ["pending", "in_progress"]] }, 1, 0] },
            },
            inReview: { $sum: { $cond: [{ $eq: ["$status", "review"] }, 1, 0] } },
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
      ]),

      Task.find({ ...inMyProjects, status: "review" })
        .populate("assignedTo", "name")
        .populate("project", "name code")
        .sort({ updatedAt: -1 })
        .limit(6),

      Task.find({
        ...inMyProjects,
        status: { $ne: "completed" },
        dueDate: { $ne: null },
      })
        .populate("assignedTo", "name")
        .populate("project", "name")
        .sort({ dueDate: 1 })
        .limit(6),

      Notification.find({ user: req.leader._id }).sort({ createdAt: -1 }).limit(6),

      Task.countDocuments({
        ...inMyProjects,
        status: { $ne: "completed" },
        dueDate: { $lt: startOfToday },
      }),

      Task.countDocuments({
        ...inMyProjects,
        status: { $ne: "completed" },
        dueDate: { $gte: startOfToday, $lt: tomorrow },
      }),

      /**
       * Per project, what the board underneath it actually says.
       *
       * The headline percentage is an average of each task's own progress, so
       * "78%" and "3 of 11 done" are both true and answer different questions.
       * A manager deciding where to spend today needs the second one.
       */
      Task.aggregate([
        { $match: inMyProjectsAgg },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
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
      ]),

      /* ------------------------------------------------- this week's numbers */

      Task.find({
        ...inMyProjects,
        status: "completed",
        completedAt: { $gte: weekStart },
      }).select("dueDate completedAt"),

      /* --------------------------------------------- what is awaiting a decision */

      ChangeRequest.countDocuments({
        project: { $in: projectIds },
        status: { $in: ["open", "in_progress"] },
      }),

      CodeSubmission.countDocuments({ reviewer: req.leader._id, status: "pending" }),

      /**
       * The most recently raised issue nobody has resolved.
       *
       * Newest first, deliberately — the severity counts beside it already say
       * how bad things are, and this answers the other question: what has just
       * landed. Sorting by severity would have needed a rank anyway: Mongo
       * compares it as a string, where "low" outranks "high" outranks
       * "critical".
       */
      Issue.findOne({ ...inMyProjects, status: { $in: ["open", "in_progress"] } })
        .populate("raisedBy", "name")
        .sort({ createdAt: -1 })
        .select("title severity status raisedBy createdAt"),

      /* ------------------------------------- what the team has been doing
       *
       * Read from the tasks and issues themselves rather than from the
       * manager's notifications: a notification is one line about one event
       * addressed to one person, and half of what a manager wants to see
       * here — somebody finishing something quietly — never produces one.
       */
      Task.find({
        ...inMyProjects,
        status: "completed",
        completedAt: { $gte: activitySince },
      })
        .populate("assignedTo", "name")
        .select("title assignedTo completedAt")
        .sort({ completedAt: -1 })
        .limit(10),

      Task.find({ ...inMyProjects, status: "review", updatedAt: { $gte: activitySince } })
        .populate("assignedTo", "name")
        .select("title assignedTo updatedAt")
        .sort({ updatedAt: -1 })
        .limit(10),

      Issue.find({ ...inMyProjects, createdAt: { $gte: activitySince } })
        .populate("raisedBy", "name")
        .select("title raisedBy severity status createdAt")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    const monthMap = tasksDonePerMonth.reduce((acc, row) => {
      acc[`${row._id.y}-${row._id.m}`] = row.count;
      return acc;
    }, {});

    const statusCounts = countsToObject(tasksByStatus);
    const tasksTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    const tasksCompleted = statusCounts.completed || 0;

    const memberById = teamMembers.reduce((acc, m) => {
      acc[String(m._id)] = m;
      return acc;
    }, {});

    const workByMember = workloadRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    /**
     * Each person sorted into one of three states.
     *
     *   overdue    they are carrying work that is already late
     *   attention  nothing late, but something of theirs is sitting with the
     *              manager waiting to be reviewed
     *   on_track   everything else
     *
     * The middle one is deliberately about the manager rather than the
     * person. Work submitted and not looked at is the manager's queue, not a
     * problem with whoever submitted it, and a board that marks them amber
     * for their own manager's backlog would be reading the wrong person.
     */
    const members = teamMembers.map((person) => {
      const work = workByMember[String(person._id)] || {};
      const overdue = work.overdue || 0;
      const inReview = work.inReview || 0;

      return {
        _id: person._id,
        name: person.name,
        designation: person.designation || "",
        completed: work.completed || 0,
        pending: work.pending || 0,
        inReview,
        overdue,
        state: overdue ? "overdue" : inReview ? "attention" : "on_track",
      };
    });

    const teamHealth = members.reduce(
      (acc, person) => ({ ...acc, [person.state]: acc[person.state] + 1 }),
      { on_track: 0, attention: 0, overdue: 0 }
    );

    /* ------------------------------------------------ this week, in four numbers */

    /**
     * On-time is measured only against tasks that had a due date.
     *
     * A task nobody put a date on cannot be late, and counting it as on-time
     * would let a team with no deadlines report 100% — which is the one
     * number here somebody might actually act on.
     */
    const weekDated = weekCompleted.filter((task) => task.dueDate);
    const weekOnTime = weekDated.filter(
      (task) => new Date(task.completedAt) <= new Date(new Date(task.dueDate).setHours(23, 59, 59, 999))
    ).length;

    const week = {
      completed: weekCompleted.length,
      inProgress: statusCounts.in_progress || 0,
      overdue: overdueCount,
      // null, not zero: nothing finished with a deadline is unmeasured rather
      // than measured at nothing
      onTimeRate: weekDated.length ? Math.round((weekOnTime / weekDated.length) * 100) : null,
      measuredAgainst: weekDated.length,
      from: weekStart,
    };

    /* ---------------------------------------------- per project, not an average */

    const tasksByProject = projectTaskRows.reduce((acc, row) => {
      acc[String(row._id)] = row;
      return acc;
    }, {});

    const projectRows = projects
      .filter((project) => ["planning", "in_progress", "on_hold"].includes(project.status))
      .map((project) => {
        const board = tasksByProject[String(project._id)] || {};
        return {
          _id: project._id,
          name: project.name,
          code: project.code || "",
          status: project.status,
          progress: project.progress ?? 0,
          client: project.client?.company || project.client?.name || "",
          endDate: project.endDate,
          completed: board.completed || 0,
          total: board.total || 0,
          overdue: board.overdue || 0,
        };
      })
      .sort((a, b) => b.overdue - a.overdue || a.progress - b.progress);

    /* -------------------------------------------- what the team has done */

    const taskLink = (id) => `/operation-manager/tasks/assigned?id=${id}`;

    const activity = [
      ...wasCompleted.map((task) => ({
        id: `done-${task._id}`,
        kind: "completed",
        at: task.completedAt,
        who: task.assignedTo?.name || "Somebody",
        text: "completed a task",
        detail: task.title,
        link: taskLink(task._id),
      })),
      ...wasSubmitted.map((task) => ({
        id: `review-${task._id}`,
        kind: "review",
        at: task.updatedAt,
        who: task.assignedTo?.name || "Somebody",
        text: "submitted work for review",
        detail: task.title,
        link: "/operation-manager/daily-review",
      })),
      ...wasRaised.map((issue) => ({
        id: `issue-${issue._id}`,
        kind: "blocker",
        at: issue.createdAt,
        who: issue.raisedBy?.name || "Somebody",
        text: "raised a blocker",
        detail: issue.title,
        link: "/operation-manager/issues",
      })),
    ]
      .filter((row) => row.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

    return res.status(200).json({
      stats: {
        projects: projects.length,
        // Same definition the "Active Projects" screen uses, so the two agree
        activeProjects: projects.filter((p) =>
          ["planning", "in_progress", "on_hold"].includes(p.status)
        ).length,
        completedProjects: projects.filter((p) =>
          ["completed", "cancelled"].includes(p.status)
        ).length,
        teamSize: teamMembers.length,
        tasksTotal,
        tasksCompleted,
        tasksPending: (statusCounts.pending || 0) + (statusCounts.in_progress || 0),
        tasksInReview: statusCounts.review || 0,
        overdueTasks: overdueCount,
        dueToday: dueTodayCount,
        openIssues,
        // Decisions sitting with this manager, from the two places that
        // actually wait on one
        pendingApprovals: openChangeRequests + codeReviewQueue,
        changeRequests: openChangeRequests,
        codeReviews: codeReviewQueue,
        completionRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
        avgProgress: projects.length
          ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length)
          : 0,
      },
      charts: {
        monthlyTrend: buckets.map((b) => ({
          month: b.label,
          tasksCompleted: monthMap[b.key] || 0,
        })),
        tasksByStatus: statusCounts,
        issuesBySeverity: countsToObject(issuesBySeverity),
        projectProgress: projects.map((p) => ({
          name: p.name,
          progress: p.progress,
          status: p.status,
        })),
        teamWorkload: workloadRows.map((row) => ({
          name: memberById[String(row._id)]?.name || "Unknown",
          completed: row.completed,
          pending: row.pending,
        })),
      },
      week,

      /**
       * Every severity named, including the ones at zero. A key that is simply
       * absent makes the reader render "undefined" or hide the row, and
       * "no critical issues" is a thing a manager wants stated rather than
       * left out.
       */
      issues: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        ...countsToObject(issuesBySeverity),
        open: openIssues,
        latest: oldestIssue,
      },

      projectRows,

      team: {
        ...teamHealth,
        members: members.sort(
          (a, b) => b.overdue - a.overdue || b.inReview - a.inReview || b.pending - a.pending
        ),
      },

      recent: {
        projects: projects.slice(0, 5),
        pendingReviews,
        upcoming,
        notifications,
        activity,
      },
    });
  } catch (err) {
    console.error("leader getDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
