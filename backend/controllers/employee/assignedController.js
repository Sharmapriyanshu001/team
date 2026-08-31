import Project from "../../models/Project.js";
import Task from "../../models/Task.js";
import CodeProject from "../../models/CodeProject.js";
import { getScope } from "../../middleware/employeeAuth.js";
import { accessFor } from "../codeProjectController.js";
import { assignedByFor } from "../../utils/projectTeam.js";

/**
 * "My Work" — everything a team leader has handed to this employee, in one
 * place and in the order it was given.
 *
 * The pieces already existed on separate screens: the project under Projects,
 * the task under Tasks, the code under Code. What was missing was the sentence
 * that ties them together — *your team leader gave you this, on this date, and
 * here is the code to do it with*. An employee should not have to check three
 * screens to notice they were given something.
 *
 * Nothing here is a new grant. Every row is something this account can already
 * reach; the endpoint only groups it and says where it came from.
 */

const idOf = (value) => String(value?._id || value || "");

// GET /api/employee/assigned
export const getAssignedWork = async (req, res) => {
  try {
    const { projectIds } = await getScope(req);

    const [projects, tasks, codeProjects] = await Promise.all([
      Project.find({ _id: { $in: projectIds } })
        .populate("client", "name company")
        .populate("teamLeader", "name email designation")
        .sort({ updatedAt: -1 }),

      /**
       * Their own tasks. Not narrowed to the projects above: a leader can hand
       * somebody a task and the project it belongs to is picked up from the
       * same act, but an older task may point at a project they have since
       * been taken off, and hiding it would lose work rather than tidy it.
       */
      Task.find({ assignedTo: req.employee._id })
        .populate("project", "name code")
        .populate("assignedBy", "name role designation")
        .sort({ createdAt: -1 })
        .limit(200),

      // The workspaces they were given, live ones only
      CodeProject.find({ employees: req.employee._id, deletedAt: null })
        .populate("project", "name code")
        .populate("teamLeaders", "name role")
        .sort({ updatedAt: -1 }),
    ]);

    /* ------------------------------------------------ group by project */

    const groups = new Map();

    const groupFor = (project, fallbackId, fallbackName) => {
      const key = idOf(project) || fallbackId || "none";
      if (!groups.has(key)) {
        groups.set(key, {
          project: project || (fallbackId ? { _id: fallbackId, name: fallbackName } : null),
          tasks: [],
          codeProjects: [],
        });
      }
      return groups.get(key);
    };

    projects.forEach((project) => {
      const from = assignedByFor(
        project.memberAssignments,
        req.employee._id,
        project.teamLeader?.name
      );

      const row = project.toObject();
      // Everybody else's record is nobody else's business
      delete row.memberAssignments;

      const group = groupFor(project);
      group.project = {
        ...row,
        assignedBy: from.assignedBy,
        assignedAt: from.assignedAt,
        assignedExact: from.exact,
      };
    });

    tasks.forEach((task) => {
      const group = groupFor(task.project, "none", "Not on a project");
      group.tasks.push(task);
    });

    codeProjects.forEach((doc) => {
      const row = doc.toObject();
      const from = assignedByFor(row.employeeAssignments, req.employee._id);
      delete row.employeeAssignments;

      const group = groupFor(doc.project, "none", "Not on a project");
      group.codeProjects.push({
        ...row,
        // The same shape the workspace board reads, so the card is identical
        myAccess: accessFor(doc, req.employee),
        assignedBy: from.assignedBy,
        assignedAt: from.assignedAt,
      });
    });

    /**
     * Newest first, by the most recent thing in each group rather than by the
     * project's own date — what matters is when something last landed on this
     * person's desk.
     */
    const latestOf = (group) =>
      Math.max(
        0,
        ...group.tasks.map((task) => new Date(task.createdAt).getTime()),
        ...group.codeProjects.map((doc) => new Date(doc.assignedAt || doc.updatedAt).getTime()),
        group.project?.assignedAt ? new Date(group.project.assignedAt).getTime() : 0
      );

    const items = [...groups.values()]
      .filter((group) => group.project || group.tasks.length || group.codeProjects.length)
      .sort((a, b) => latestOf(b) - latestOf(a));

    // The dot on the sidebar: work they have not opened their task list for yet
    const unseen = tasks.filter((task) => task.seenByAssignee === false).length;

    const openTasks = tasks.filter((task) => task.status !== "completed").length;

    return res.status(200).json({
      items,
      total: items.length,
      unseen,
      openTasks,
      workspaces: codeProjects.length,
    });
  } catch (err) {
    console.error("employee getAssignedWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
