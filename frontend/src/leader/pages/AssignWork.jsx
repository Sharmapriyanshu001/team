import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ClipboardCheck,
  Code2,
  Eye,
  FolderKanban,
  ListChecks,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";

import leaderApi from "../leaderApi";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipList,
  EmptyState,
  Field,
  Input,
  Loader,
  MultiSelect,
  PageHeader,
  ProgressBar,
  Select,
  Textarea,
} from "../../shared/components/ui";

/**
 * Assign Work — the middle of admin → team leader → employee.
 *
 * The admin hands a project to a leader. This is where the leader hands it on:
 * puts their own people on it, gives out tasks and follows them, and lets the
 * team into the workspace. Whatever those people submit comes back to this same
 * leader under Code Reviews, so the round trip starts and ends here.
 *
 * The point of doing it all on one screen is that these are one decision, not
 * four: you do not choose who is on a project in the abstract, you choose it
 * because you are about to give somebody a job.
 *
 * So both pickers here offer every active employee, not only this leader's own
 * reports and not only the people already on the project. Their own people are
 * flagged and sorted first, but work does not fall neatly along the org chart,
 * and a leader should not have to visit two dialogs to give somebody a job.
 * Picking a name that is not on the project yet is what puts them on it — the
 * server does that on the same call, and says so in its answer.
 *
 * The boundary is the project, which must be one the admin gave them, and the
 * role: a team leader, an admin or a disabled account is never in these lists
 * and would be refused if one were sent anyway.
 *
 * All of that is decided by the server. The lists below are a convenience for
 * choosing; they are not the permission.
 */

const STATUS_LABELS = {
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TASK_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "In review" },
  { value: "completed", label: "Completed" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

// Kept in step with MAX_UPLOAD_BYTES on the server
const MAX_UPLOAD_MB = 50;

/** Whose id, among a project's loaded tasks, already holds an open task with this title. */
const holdersOf = (tasks, title) => {
  const needle = String(title || "").trim().toLowerCase();
  if (!needle) return new Set();

  return new Set(
    tasks
      .filter(
        (task) =>
          task.status !== "completed" && (task.title || "").trim().toLowerCase() === needle
      )
      .map((task) => String(task.assignedTo?._id || task.assignedTo || ""))
      .filter(Boolean)
  );
};

export default function AssignWork() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Task lists are fetched per project, the first time one is opened
  const [tasksByProject, setTasksByProject] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [busyTask, setBusyTask] = useState("");

  // Only one of these is ever open
  const [teamFor, setTeamFor] = useState(null);
  const [taskFor, setTaskFor] = useState(null);
  const [duplicate, setDuplicate] = useState(null); // { names, title }
  const [workspaceFor, setWorkspaceFor] = useState(null); // { project, codeProject }
  const [deleteTask, setDeleteTask] = useState(null); // { projectId, task }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await leaderApi.get("/leader/assign-work");
      setItems(data.items || []);
      setTeam(data.team || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load your projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ------------------------------------------------------------- tasks */

  const loadTasks = useCallback(async (projectId) => {
    setTasksByProject((prev) => ({ ...prev, [projectId]: { ...prev[projectId], loading: true } }));
    try {
      const { data } = await leaderApi.get(`/leader/tasks?project=${projectId}&limit=100`);
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: { loading: false, items: data.items || [], error: "" },
      }));
    } catch (err) {
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: {
          loading: false,
          items: [],
          error: err.response?.data?.message || "Could not load the tasks",
        },
      }));
    }
  }, []);

  const toggle = (projectId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        if (!tasksByProject[projectId]) loadTasks(projectId);
      }
      return next;
    });
  };

  /** One field on one task — status, assignee, priority or date. */
  const patchTask = async (projectId, task, payload) => {
    setBusyTask(task._id);
    try {
      const { data } = await leaderApi.put(`/leader/tasks/${task._id}`, payload);
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: {
          ...prev[projectId],
          items: (prev[projectId]?.items || []).map((row) =>
            row._id === task._id ? data.item : row
          ),
        },
      }));
      setSuccess(data.message || "Task updated");
      setError("");
      // Counts on the card, and possibly the project's member list, moved
      await load();
    } catch (err) {
      const data = err.response?.data;

      // Handing a task to somebody who already has that same job is refused
      // here as well, and says so the same way
      if (data?.code === "duplicate_task") {
        setDuplicate({ names: data.duplicates || [], title: data.title || task.title });
        return;
      }

      setError(data?.message || "Could not update that task");
    } finally {
      setBusyTask("");
    }
  };

  const removeTask = async () => {
    if (!deleteTask) return;
    const { projectId, task } = deleteTask;

    setSaving(true);
    try {
      const { data } = await leaderApi.delete(`/leader/tasks/${task._id}`);
      setTasksByProject((prev) => ({
        ...prev,
        [projectId]: {
          ...prev[projectId],
          items: (prev[projectId]?.items || []).filter((row) => row._id !== task._id),
        },
      }));
      setSuccess(data.message || "Task deleted");
      setError("");
      setDeleteTask(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that task");
      setDeleteTask(null);
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------------------------------- the modals */

  const saveMembers = async (members) => {
    setSaving(true);
    try {
      const { data } = await leaderApi.put(`/leader/projects/${teamFor._id}/members`, { members });
      setSuccess(data.message || "Team updated");
      setError("");
      setTeamFor(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update the team");
      setTeamFor(null);
    } finally {
      setSaving(false);
    }
  };

  const saveWorkspace = async (employees) => {
    setSaving(true);
    try {
      const { data } = await leaderApi.put(
        `/leader/code-projects/${workspaceFor.codeProject._id}/employees`,
        { employees }
      );
      setSuccess(data.message || "Access updated");
      setError("");
      setWorkspaceFor(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not share the workspace");
      setWorkspaceFor(null);
    } finally {
      setSaving(false);
    }
  };

  const createTask = async (payload) => {
    const projectId = taskFor._id;
    const { zipFile, zipName } = payload;

    /**
     * Asked here first, off the task list this screen already has, so the
     * answer is immediate and the leader is not made to wait on a round trip
     * that was always going to be refused.
     *
     * The server asks the same question and is the one that decides — this
     * list can be stale, and two leaders can press Assign at once. This is
     * courtesy; that is the rule.
     */
    const holders = holdersOf(tasksByProject[projectId]?.items || [], payload.title);
    const clashing = (payload.assignees || [])
      .filter((id) => holders.has(String(id)))
      .map((id) => team.find((m) => String(m._id) === String(id))?.name)
      .filter(Boolean);

    if (clashing.length) {
      setDuplicate({ names: clashing, title: payload.title });
      return;
    }

    setSaving(true);
    try {
      /**
       * The code goes up first, on purpose. A rejected archive then means
       * nothing was created and Assign can simply be pressed again — the
       * other order would leave the tasks behind, to be made a second time
       * on the retry.
       */
      if (zipFile) {
        const body = new FormData();
        body.append("file", zipFile);
        body.append("name", zipName);
        body.append("project", projectId);
        // The same people who are getting the task get the workspace
        body.append("employees", JSON.stringify(payload.assignees || []));
        body.append("description", payload.title || "");

        await leaderApi.post("/leader/code-projects", body, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      const { data } = await leaderApi.post("/leader/tasks", { ...payload, project: projectId });
      setSuccess(`${data.message || "Task assigned"}${zipFile ? " — code sent with it" : ""}`);
      setError("");
      setTaskFor(null);

      // Open the project's task list on whatever was just added to it
      setExpanded((prev) => new Set(prev).add(projectId));
      await Promise.all([loadTasks(projectId), load()]);
    } catch (err) {
      const data = err.response?.data;

      /**
       * A duplicate is not a failure to report and move on from — it is a
       * decision the leader is in the middle of. So the assign box stays open
       * underneath with their title, dates and other picks untouched, and
       * dismissing the popup puts them straight back into it.
       */
      if (data?.code === "duplicate_task") {
        setDuplicate({ names: data.duplicates || [], title: data.title || payload.title });
        return;
      }

      setError(data?.message || "Could not create that task");
      setTaskFor(null);
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------------- view */

  return (
    <div>
      <PageHeader
        title="Assign Work"
        subtitle="Projects the admin gave you — put your team on them, hand out tasks, and share the workspace"
      >
        <Button variant="outline" onClick={() => navigate("/team-leader/code-reviews")}>
          <ClipboardCheck size={15} />
          Code Reviews
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      {success && <Alert tone="success">{success}</Alert>}

      {loading ? (
        <Card>
          <Loader label="Loading your projects…" />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="No projects assigned to you yet"
            message="When an admin puts you on a project, it appears here and you can hand it down to your team."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((project) => (
            <ProjectCard
              key={project._id}
              project={project}
              team={team}
              open={expanded.has(project._id)}
              tasks={tasksByProject[project._id]}
              busyTask={busyTask}
              onToggle={() => toggle(project._id)}
              onManageTeam={() => setTeamFor(project)}
              onAssignTask={() => {
                // The duplicate check reads this project's tasks, which are
                // otherwise only fetched when somebody expands the list
                if (!tasksByProject[project._id]) loadTasks(project._id);
                setTaskFor(project);
              }}
              onPatchTask={(task, payload) => patchTask(project._id, task, payload)}
              onDeleteTask={(task) => setDeleteTask({ projectId: project._id, task })}
              onShareWorkspace={(codeProject) => setWorkspaceFor({ project, codeProject })}
              onOpenWorkspace={(codeProject) =>
                navigate(`/team-leader/code-projects/${codeProject._id}/workspace`)
              }
            />
          ))}
        </div>
      )}

      {teamFor && (
        <PeopleModal
          title="Who is on this project"
          subtitle={teamFor.name}
          hint="Adding somebody puts the project on their own screen and lets them submit code against it. Any active employee can be added, not only your own reports."
          team={team}
          selected={(teamFor.members || []).map((m) => m._id || m)}
          loading={saving}
          confirmLabel="Save team"
          onConfirm={saveMembers}
          onClose={() => setTeamFor(null)}
        />
      )}

      {workspaceFor && (
        <PeopleModal
          title="Who can open this workspace"
          subtitle={workspaceFor.codeProject.name}
          hint="They get the same workspace you have. What they may do in it — edit, create, run — stays the admin's setting."
          team={team}
          selected={(workspaceFor.codeProject.employees || []).map((m) => m._id || m)}
          loading={saving}
          confirmLabel="Save access"
          onConfirm={saveWorkspace}
          onClose={() => setWorkspaceFor(null)}
        />
      )}

      {taskFor && (
        <TaskModal
          project={taskFor}
          team={team}
          existing={tasksByProject[taskFor._id]?.items || []}
          loading={saving}
          onConfirm={createTask}
          // Escape closes the topmost thing on screen, and while the popup is
          // up that is the popup — not the box behind it holding everything
          // the leader has typed
          onClose={() => !duplicate && setTaskFor(null)}
        />
      )}

      <DuplicateDialog duplicate={duplicate} onClose={() => setDuplicate(null)} />

      <ConfirmDialog
        open={Boolean(deleteTask)}
        title="Delete this task"
        message={`Delete "${deleteTask?.task?.title}"? It disappears from their list too. This does not touch the project or any code.`}
        confirmLabel="Delete task"
        loading={saving}
        onConfirm={removeTask}
        onClose={() => setDeleteTask(null)}
      />
    </div>
  );
}

/* ---------------------------------------------------- already sent that one */

/**
 * The one thing this screen refuses outright, so it is said in front of the
 * leader rather than in the alert strip at the top of a page they are not
 * looking at.
 *
 * It names the people, because with several ticked at once "somebody already
 * has this" leaves them opening tasks one by one to find out who.
 */
function DuplicateDialog({ duplicate, onClose }) {
  if (!duplicate) return null;

  const { names = [], title = "" } = duplicate;
  const one = names.length === 1;

  return (
    <Modal
      open
      title="Already sent"
      onClose={onClose}
      size="sm"
      footer={<Button onClick={onClose}>Got it</Button>}
    >
      <p className="text-sm leading-relaxed text-slate-700">
        You have already given{" "}
        <span className="font-medium text-slate-900">{names.join(", ") || "them"}</span>{" "}
        <span className="font-medium text-slate-900">“{title}”</span> on this project, and{" "}
        {one ? "it is" : "they are"} still open.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {one ? "Untick that name" : "Untick those names"} to send this to everybody else, or give
        this one a different title. Nothing has been assigned.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------- one project */

function ProjectCard({
  project,
  team,
  open,
  tasks,
  busyTask,
  onToggle,
  onManageTeam,
  onAssignTask,
  onPatchTask,
  onDeleteTask,
  onShareWorkspace,
  onOpenWorkspace,
}) {
  const members = project.members || [];
  const counts = project.taskCounts || {};
  const back = project.submissionCounts || {};
  const openCount = (counts.pending || 0) + (counts.in_progress || 0);
  const hasTeam = team.length > 0;


  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <FolderKanban size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{project.name}</p>
            {project.code && <span className="text-xs text-slate-400">{project.code}</span>}
            <Badge value={project.status}>{STATUS_LABELS[project.status] || project.status}</Badge>
            <Badge value={project.priority} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            {project.client?.name && <span>{project.client.name}</span>}
            <span>Due {formatDate(project.endDate)}</span>
          </p>
        </div>

        <div className="shrink-0">
          <ProgressBar value={project.progress || 0} />
        </div>
      </div>

      {/* ------------------------------------------------------------ team */}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Users size={13} />
            Team
          </span>

          {members.length ? (
            members.map((member) => (
              <span
                key={member._id}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700"
                title={member.designation || ""}
              >
                {member.name}
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-400">
              Nobody yet — assigning a task below is enough to put somebody on it
            </span>
          )}

          <Button size="sm" variant="ghost" className="ml-auto" onClick={onManageTeam}>
            <UserPlus size={13} />
            {members.length ? "Manage team" : "Add your team"}
          </Button>
        </div>

        {!hasTeam && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-800 ring-1 ring-inset ring-amber-100">
            There are no active employees to assign to yet. Ask an admin to add some.
          </p>
        )}
      </div>

      {/* ----------------------------------------------------------- tasks */}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ChevronRight
            size={13}
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          />
          <ListChecks size={13} />
          Tasks
        </button>
        <span className="text-xs text-slate-600">
          {openCount} open · {counts.review || 0} in review · {counts.completed || 0} done
        </span>

        {(back.pending || 0) > 0 && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
            {back.pending} submission{back.pending === 1 ? "" : "s"} waiting on you
          </span>
        )}

        {/* Open whenever there is anybody to assign to. Work does not have to
            wait for the project team to be set up first — picking somebody who
            is not on it yet is what puts them on it. */}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!hasTeam}
          title={hasTeam ? "" : "There are no active employees to assign to yet"}
          onClick={onAssignTask}
        >
          <Plus size={13} />
          Assign task
        </Button>
      </div>

      {/* Every employee, so a task can be moved to anybody — the same rule as
          handing one out in the first place. Picking somebody who is not on
          the project puts them on it, which the server does on the save. */}
      {open && (
        <TaskList
          state={tasks}
          team={team}
          busyTask={busyTask}
          onPatch={onPatchTask}
          onDelete={onDeleteTask}
        />
      )}

      {/* ------------------------------------------------------- workspace */}

      {(project.codeProjects || []).length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {project.codeProjects.map((codeProject) => (
            <div
              key={codeProject._id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Code2 size={13} />
                {codeProject.name}
              </span>
              <Badge tone="slate">{codeProject.stack}</Badge>
              <span className="text-[11px] text-slate-500">
                {(codeProject.employees || []).length
                  ? (codeProject.employees || []).map((e) => e.name).join(", ")
                  : "not shared yet"}
              </span>

              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => onShareWorkspace(codeProject)}>
                  <UserPlus size={13} />
                  Give access
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!codeProject.workspaceReady}
                  onClick={() => onOpenWorkspace(codeProject)}
                >
                  <Eye size={13} />
                  Open
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- task rows */

/**
 * The tasks on one project, editable in place.
 *
 * Every control here writes straight through on change rather than collecting
 * a form: these are one-field decisions — move it along, hand it to somebody
 * else, push the date — and making the leader press Save on each would be the
 * slow way round.
 */
/**
 * Who a task can be moved to: the project's own people, plus whoever holds it
 * now if that is somebody else.
 *
 * The second half matters for work assigned before the team was narrowed, or
 * handed over by an admin. Without it the dropdown would find no option
 * matching the task's assignee and fall back to its placeholder, so a task
 * that is very much somebody's would read "Nobody".
 */
const assigneeOptions = (team, current) => {
  const options = team.map((m) => ({ value: m._id, label: m.name }));
  if (current?._id && !team.some((m) => String(m._id) === String(current._id))) {
    options.unshift({ value: current._id, label: `${current.name} (off the project)` });
  }
  return options;
};

function TaskList({ state, team, busyTask, onPatch, onDelete }) {
  if (!state || state.loading) {
    return (
      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-4">
        <Loader label="Loading tasks…" />
      </div>
    );
  }

  if (state.error) {
    return (
      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-100">
        {state.error}
      </p>
    );
  }

  if (!state.items.length) {
    return (
      <p className="mt-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
        No tasks on this project yet. Use <span className="font-medium">Assign task</span> to give
        somebody the first one.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {state.items.map((task) => {
        const busy = busyTask === task._id;

        return (
          <div
            key={task._id}
            className={`rounded-lg bg-slate-50 px-2.5 py-2 ${busy ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800" title={task.title}>
                {task.title}
              </span>
              <Badge value={task.priority} />
              <span className="text-[11px] text-slate-400">
                {task.dueDate ? `due ${formatDate(task.dueDate)}` : "no date"}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Select
                className="w-40 py-1 text-xs"
                value={task.assignedTo?._id || ""}
                disabled={busy}
                onChange={(e) => onPatch(task, { assignedTo: e.target.value })}
                options={assigneeOptions(team, task.assignedTo)}
                placeholder="Nobody"
              />
              <Select
                className="w-36 py-1 text-xs"
                value={task.status}
                disabled={busy}
                onChange={(e) => onPatch(task, { status: e.target.value })}
                options={TASK_STATUSES}
              />
              <Input
                type="date"
                className="w-36 py-1 text-xs"
                value={dateInput(task.dueDate)}
                disabled={busy}
                onChange={(e) => onPatch(task, { dueDate: e.target.value })}
              />

              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(task)}
                className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                title="Delete this task"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {task.reviewNote && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Your last comment: <span className="text-slate-700">{task.reviewNote}</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ pick people */

/**
 * One checkbox list, used for both "who is on the project" and "who can open
 * the workspace". They are different grants, but the choosing is identical and
 * the server decides what each one means.
 */
function PeopleModal({
  title,
  subtitle,
  hint,
  team,
  selected,
  loading,
  confirmLabel,
  onConfirm,
  onClose,
}) {
  /**
   * Seeded from the current list, but narrowed to people this box can actually
   * offer. Anyone on the project who is not an active employee — a team leader
   * the admin put there — is not in `team`, so ticking them back is not
   * something this box can do, and sending their id would be refused. The
   * server leaves them on the project regardless; they are simply not part of
   * the list a leader manages.
   */
  const [picked, setPicked] = useState(() => {
    const choosable = new Set(team.map((member) => String(member._id)));
    return new Set(selected.map(String).filter((id) => choosable.has(id)));
  });

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(String(id)) ? next.delete(String(id)) : next.add(String(id));
      return next;
    });

  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => onConfirm([...picked])}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">{hint}</p>

      {!team.length ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          There are no active employees to choose from yet.
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-auto">
          {team.map((member) => {
            const on = picked.has(String(member._id));
            return (
              <button
                key={member._id}
                type="button"
                onClick={() => toggle(member._id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ring-1 ring-inset transition-colors ${
                  on
                    ? "bg-blue-50 text-blue-900 ring-blue-200"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{member.name}</span>
                    {member.reportsToMe && (
                      <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-600">
                        your team
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {member.designation || member.email}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{member.openTasks} open</span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- give work */

/**
 * Give one job to one person, or to several at once.
 *
 * Several is a list of tasks, not a task with a list on it — the server splits
 * it — so each person gets their own to move along, and the same job going to
 * three people does not become three people waiting on each other.
 *
 * Nobody is ticked to begin with. The old single-pick box defaulted to
 * whoever sorted first, which is a fine shortcut when the answer is visibly
 * one name and a bad one when it is a checklist: work quietly landing on
 * somebody nobody chose is worse than one more click.
 */
function TaskModal({ project, team, existing = [], loading, onConfirm, onClose }) {
  const onProject = new Set((project.members || []).map((m) => String(m._id || m)));

  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    dueDate: "",
  });
  const [assignees, setAssignees] = useState([]);

  // Optional: the code to do the job with, sent in the same act
  const [zipFile, setZipFile] = useState(null);
  const [zipName, setZipName] = useState("");
  const [zipError, setZipError] = useState("");

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const ready = form.title.trim() && assignees.length > 0 && !zipError;

  const pickZip = (e) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      setZipFile(null);
      setZipError("");
      return;
    }

    // Said here as well as on the server, because an archive that is going
    // to be refused should not be uploaded first
    if (!/\.zip$/i.test(file.name)) {
      setZipFile(null);
      setZipError("Only a .zip can be sent");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setZipFile(null);
      setZipError(`That archive is over ${MAX_UPLOAD_MB} MB`);
      return;
    }

    setZipFile(file);
    setZipError("");
    setZipName((prev) => prev || file.name.replace(/\.zip$/i, ""));
  };

  // Who is still holding this exact job, recomputed as the title is typed. The
  // names are flagged in the list rather than removed from it: a leader who
  // meant to type a different title should see why a name looks unavailable,
  // and pressing Assign anyway is answered properly instead of by a control
  // that does nothing.
  const holders = holdersOf(existing, form.title);
  const clashing = assignees.filter((id) => holders.has(String(id)));

  // Named so the notice below can say who is about to be added, rather than
  // just that somebody is
  const joining = assignees
    .filter((id) => !onProject.has(String(id)))
    .map((id) => team.find((m) => String(m._id) === String(id))?.name)
    .filter(Boolean);

  return (
    <Modal
      open
      title="Assign a task"
      subtitle={project.name}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={!ready}
            onClick={() =>
              onConfirm({
                ...form,
                title: form.title.trim(),
                assignees,
                zipFile,
                zipName: zipName.trim() || form.title.trim(),
              })
            }
          >
            {assignees.length > 1 ? `Assign to ${assignees.length}` : "Assign"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="What needs doing" required>
          <Input
            name="title"
            value={form.title}
            onChange={change}
            placeholder="Build the attendance export"
          />
        </Field>

        <Field label="Details" hint="They see this on their task.">
          <Textarea
            name="description"
            rows={3}
            value={form.description}
            onChange={change}
            placeholder="Anything they need to know before starting"
          />
        </Field>

        {/* Every active employee, not only the ones already on this project —
            picking somebody who is not on it is what puts them on it, which the
            server does on the same call. Narrowing this to current members was
            the reason a leader with a company full of employees saw two names. */}
        <Field
          label="Who"
          required
          hint="Any employee. Pick as many as you need — each gets their own task."
        >
          {team.length ? (
            <div className="grid gap-2">
              <MultiSelect
                options={team.map((m) => ({
                  value: m._id,
                  label: [
                    m.name,
                    m.reportsToMe ? "" : " (other team)",
                    onProject.has(String(m._id)) ? "" : " — not on it yet",
                    holders.has(String(m._id))
                      ? " · already has this"
                      : ` · ${m.openTasks} open`,
                  ].join(""),
                }))}
                value={assignees}
                onChange={setAssignees}
                placeholder="Search employees…"
                emptyLabel="No employees to choose from"
              />
              <ChipList
                items={assignees.map((id) => ({
                  value: id,
                  label: team.find((m) => String(m._id) === String(id))?.name || "Unknown",
                }))}
                onRemove={(id) =>
                  setAssignees((prev) => prev.filter((value) => String(value) !== String(id)))
                }
                empty="Nobody picked yet"
              />
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
              There are no active employees to assign to yet. Ask an admin to add some.
            </p>
          )}
        </Field>

        {clashing.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
            {clashing
              .map((id) => team.find((m) => String(m._id) === String(id))?.name)
              .filter(Boolean)
              .join(", ")}{" "}
            already {clashing.length === 1 ? "has" : "have"} an open task called “
            {form.title.trim()}” on this project. Untick{" "}
            {clashing.length === 1 ? "that name" : "those names"} to send the rest.
          </p>
        )}

        {joining.length > 0 && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 ring-1 ring-inset ring-blue-100">
            {joining.length === 1
              ? `${joining[0]} is not on this project yet — assigning this puts them on it, so it shows up on their own screen.`
              : `${joining.length} of them are not on this project yet — assigning this puts them on it, so it shows up on their own screens.`}
          </p>
        )}

        {assignees.length > 1 && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 ring-1 ring-inset ring-blue-100">
            {assignees.length} people get this, each with their own copy of the task — so one of
            them finishing does not close it for the rest.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select name="priority" value={form.priority} onChange={change} options={PRIORITIES} />
          </Field>
          <Field label="Due">
            <Input type="date" name="dueDate" value={form.dueDate} onChange={change} />
          </Field>
        </div>

        {/* The code to do the job with, sent in the same act. Optional: plenty
            of work needs no archive, and the task alone is the point. */}
        <Field
          label="Send code with it"
          hint={`Optional — a .zip up to ${MAX_UPLOAD_MB} MB. It becomes a workspace the same people can open in the browser.`}
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-blue-500 hover:bg-blue-50/40">
            <Upload size={15} className="shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate">
              {zipFile ? zipFile.name : "Choose a .zip"}
            </span>
            {zipFile && (
              <span className="shrink-0 text-[11px] text-slate-400">
                {Math.round(zipFile.size / 1024)} KB
              </span>
            )}
            <input type="file" accept=".zip" className="hidden" onChange={pickZip} />
          </label>
        </Field>

        {zipError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-100">
            {zipError}
          </p>
        )}

        {zipFile && (
          <Field label="Call the workspace" hint="What they will see it listed as.">
            <Input
              value={zipName}
              onChange={(e) => setZipName(e.target.value)}
              placeholder={form.title.trim() || "Project code"}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
