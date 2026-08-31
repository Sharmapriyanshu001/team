import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Code2,
  Download,
  Eye,
  FolderKanban,
  Inbox,
  ListChecks,
  UserRound,
} from "lucide-react";

import employeeApi from "../employeeApi";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader } from "../../shared/components/ui";

/**
 * "My Work" — everything a team leader has handed to this employee.
 *
 * The pieces were already on three separate screens: the project under
 * Projects, the task under Tasks, the code under Code. What was missing was the
 * sentence that ties them together — *your team leader gave you this, on this
 * date, and here is the code to do it with*. Nobody should have to check three
 * screens to notice they were given something.
 *
 * Nothing here can be done that could not be done before. It is the same rows,
 * grouped by the project they belong to and stamped with where they came from.
 */

const STACK_TONES = {
  static: "sky",
  react: "blue",
  vite: "blue",
  next: "blue",
  node: "black",
  unknown: "slate",
};

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function MyWork() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ openTasks: 0, workspaces: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await employeeApi.get("/employee/assigned");
      setItems(data.items || []);
      setCounts({ openTasks: data.openTasks || 0, workspaces: data.workspaces || 0 });
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load your work");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const downloadZip = async (row) => {
    setBusyId(row._id);
    try {
      const { data } = await employeeApi.get(`/employee/code-projects/${row._id}/archive`, {
        responseType: "blob",
      });
      saveBlob(data, row.zipOriginalName || `${row.name}.zip`);
      setError("");
    } catch {
      setError("Could not download that archive");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div>
      <PageHeader
        title="My Work"
        subtitle={
          loading
            ? "Everything your team leader has given you"
            : `${counts.openTasks} open task${counts.openTasks === 1 ? "" : "s"} · ${
                counts.workspaces
              } workspace${counts.workspaces === 1 ? "" : "s"}`
        }
      />

      <Alert>{error}</Alert>

      {loading ? (
        <Card>
          <Loader label="Loading your work…" />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Nothing assigned to you yet"
            message="When your team leader puts you on a project or gives you a task, it shows up here with the code to do it."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((group, index) => (
            <ProjectGroup
              key={group.project?._id || `loose-${index}`}
              group={group}
              busyId={busyId}
              onOpenWorkspace={(id) => navigate(`/employee/code-projects/${id}/workspace`)}
              onDownload={downloadZip}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({ group, busyId, onOpenWorkspace, onDownload }) {
  const { project, tasks = [], codeProjects = [] } = group;

  return (
    <Card className="p-4">
      {/* ---------------------------------------------------- the project */}
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <FolderKanban size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{project?.name || "Not on a project"}</p>
            {project?.code && <span className="text-xs text-slate-400">{project.code}</span>}
            {project?.status && <Badge value={project.status} />}
          </div>

          {project?.assignedBy && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <UserRound size={11} />
              Sent to you by <span className="font-medium text-slate-700">{project.assignedBy}</span>
              {project.assignedAt ? ` · ${formatWhen(project.assignedAt)}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- the tasks */}
      {tasks.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <ListChecks size={13} />
            {tasks.length} task{tasks.length === 1 ? "" : "s"} for you
          </p>

          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div key={task._id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                    {task.title}
                  </span>
                  <Badge value={task.priority} />
                  <Badge value={task.status} />
                </div>

                <p className="mt-1 text-[11px] text-slate-500">
                  {task.assignedBy?.name ? `Given by ${task.assignedBy.name}` : "Given to you"}
                  {task.createdAt ? ` · ${formatWhen(task.createdAt)}` : ""}
                  {task.dueDate ? ` · due ${formatWhen(task.dueDate)}` : ""}
                </p>

                {task.description && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{task.description}</p>
                )}

                {/* What their leader said when sending it back */}
                {task.reviewNote && (
                  <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-900">
                    Review comment: {task.reviewNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --------------------------------------------------- the workspaces */}
      {codeProjects.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Code2 size={13} />
            Code sent with it
          </p>

          <div className="space-y-1.5">
            {codeProjects.map((row) => (
              <div key={row._id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {row.name}
                  </span>
                  <Badge tone={STACK_TONES[row.stack] || "slate"}>{row.stack}</Badge>
                </div>

                <p className="mt-0.5 text-[11px] text-slate-500">
                  {row.fileCount} files · {formatSize(row.totalSize)}
                  {row.assignedBy ? ` · sent by ${row.assignedBy}` : ""}
                  {row.assignedAt ? ` · ${formatWhen(row.assignedAt)}` : ""}
                </p>

                {!row.workspaceReady && (
                  <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
                    This did not extract properly — ask your team leader to send it again.
                  </p>
                )}

                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                  {/* Deliberately not disabled with the rest: when extraction
                      failed, the ZIP is the only copy still reachable. */}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === row._id}
                    onClick={() => onDownload(row)}
                  >
                    <Download size={13} />
                    Original ZIP
                  </Button>
                  <Button
                    size="sm"
                    disabled={!row.workspaceReady}
                    onClick={() => onOpenWorkspace(row._id)}
                  >
                    <Eye size={13} />
                    Open Workspace
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
