import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  FolderKanban,
  UserRound,
} from "lucide-react";

import employeeApi from "../../employeeApi";
import { formatSize, initialsOf, prettify } from "../../../shared/format";
import { saveBlob } from "../../../shared/download";
import DataTable from "../../../shared/components/DataTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
} from "../../../shared/components/ui";

const TABS = [
  { key: "mine", label: "My work" },
  { key: "files", label: "Files & archives" },
  { key: "board", label: "Whole board" },
  { key: "team", label: "Team" },
  { key: "issues", label: "Issues" },
];

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const isOverdue = (task) => {
  if (!task?.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

/** One fact about the project, stated plainly. */
function Fact({ icon: Icon, label, children }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={14} />
        <p className="text-[11px] font-medium tracking-wide uppercase">{label}</p>
      </div>
      <div className="mt-2 text-sm text-slate-800">{children}</div>
    </Card>
  );
}

export default function ProjectDetails() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id") || "";

  const [projects, setProjects] = useState([]);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("mine");

  const [loadingList, setLoadingList] = useState(true);
  // Opening straight from a project row arrives with an id already set, so
  // this starts on rather than being switched on from inside the effect
  const [loadingDetail, setLoadingDetail] = useState(Boolean(selectedId));
  const [downloadingId, setDownloadingId] = useState("");
  const [error, setError] = useState("");

  // The picker, so this screen is usable without going back to the list
  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/projects", { params: { limit: 200 } })
      .then(({ data: res }) => {
        if (!active) return;
        setProjects(res.items || []);
        if (!selectedId && res.items?.length) {
          setParams({ id: res.items[0]._id }, { replace: true });
        }
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your projects");
      })
      .finally(() => active && setLoadingList(false));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;

    employeeApi
      .get(`/employee/projects/${selectedId}`)
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err.response?.data?.message || "Could not open this project");
      })
      .finally(() => active && setLoadingDetail(false));

    return () => {
      active = false;
    };
  }, [selectedId]);

  const download = async (file) => {
    setDownloadingId(file._id);
    try {
      const { data: blob } = await employeeApi.get(`/employee/files/${file._id}/download`, {
        responseType: "blob",
      });
      saveBlob(blob, file.originalName || `${file.title}.zip`);
    } catch {
      setError("Could not download that file");
    } finally {
      setDownloadingId("");
    }
  };

  if (loadingList) return <Loader label="Loading your projects..." />;

  if (!projects.length) {
    return (
      <div>
        <PageHeader title="Project Details" />
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="You are not on a project yet"
            message="When a manager puts you on one, it shows up here with everything on it."
          />
        </Card>
      </div>
    );
  }

  const project = data?.project;
  const progress = data?.progress;

  /* -------------------------------------------------------------- columns */

  const taskColumns = (showOwner) =>
    [
      {
        key: "title",
        header: "Task",
        render: (row) => (
          <div className="max-w-sm">
            <p className="truncate font-medium text-slate-900">{row.title}</p>
            <p className="truncate text-xs text-slate-400">
              {row.assignedBy?.name ? `from ${row.assignedBy.name}` : "—"}
            </p>
          </div>
        ),
      },
      showOwner && {
        key: "assignedTo",
        header: "With",
        render: (row) => row.assignedTo?.name || "Unassigned",
      },
      { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
      { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
      {
        key: "dueDate",
        header: "Due",
        render: (row) => (
          <span className={isOverdue(row) ? "font-medium text-red-600" : ""}>
            {fmt(row.dueDate)}
          </span>
        ),
      },
      !showOwner && {
        key: "actions",
        header: "",
        className: "text-right",
        render: (row) => (
          <Link
            to={`/employee/tasks/details?id=${row._id}`}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Open
          </Link>
        ),
      },
    ].filter(Boolean);

  const fileColumns = [
    {
      key: "title",
      header: "File",
      render: (row) => (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-slate-400">
            {row.storedName ? <FileArchive size={15} /> : <FileText size={15} />}
          </span>
          <div className="max-w-xs">
            <p className="truncate font-medium text-slate-900">{row.title}</p>
            <p className="truncate text-xs text-slate-400">
              {(row.fileType || "file").toUpperCase()} · {formatSize(row.size)}
              {row.task?.title ? ` · sent with "${row.task.title}"` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "from",
      header: "Sent by",
      render: (row) => row.assignedBy?.name || row.uploadedBy?.name || "—",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Badge value={row.status} />
          {row.isMine && <Badge tone="blue">Yours</Badge>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        row.storedName ? (
          <Button
            size="sm"
            variant="outline"
            loading={downloadingId === row._id}
            onClick={() => download(row)}
          >
            <Download size={14} />
            Download
          </Button>
        ) : row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            <ExternalLink size={13} />
            Open link
          </a>
        ) : null,
    },
  ];

  const counts = data && {
    mine: data.myTasks.length,
    files: data.files.length,
    board: data.teamTasks.length,
    team: project.members?.length || 0,
    issues: data.issues.length,
  };

  return (
    <div>
      <PageHeader
        title={project?.name || "Project Details"}
        subtitle={
          project
            ? [project.code, project.client?.company || project.client?.name]
                .filter(Boolean)
                .join(" · ") || "No client recorded"
            : "Pick one of your projects"
        }
      >
        <Select
          value={selectedId}
          onChange={(e) => {
            setLoadingDetail(true);
            setData(null);
            setParams({ id: e.target.value });
          }}
          options={projects.map((p) => ({ value: p._id, label: p.name }))}
          className="w-56"
        />
        <Link
          to="/employee/projects/active"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={15} />
          All projects
        </Link>
      </PageHeader>

      <Alert>{error}</Alert>

      {loadingDetail && <Loader label="Opening the project..." />}

      {!loadingDetail && data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact icon={FolderKanban} label="Status">
              <Badge value={project.status} />
            </Fact>

            <Fact icon={CalendarDays} label="Deadline">
              <span
                className={
                  project.endDate &&
                  new Date(project.endDate) < new Date() &&
                  project.status !== "completed"
                    ? "font-medium text-red-600"
                    : ""
                }
              >
                {fmt(project.endDate)}
              </span>
              <p className="mt-0.5 text-[11px] text-slate-400">Started {fmt(project.startDate)}</p>
            </Fact>

            <Fact icon={UserRound} label="Operations manager">
              {project.operationsManager?.name || "Unassigned"}
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                {project.operationsManager?.designation || project.operationsManager?.email || ""}
              </p>
            </Fact>

            {/**
             * The project's own figure, which the server keeps in step with
             * the tasks underneath it. The counts below are stated as counts
             * rather than as a second percentage — a rival number computed a
             * different way would only make the employee wonder which is real.
             */}
            <Fact icon={FolderKanban} label="Progress">
              <ProgressBar value={progress.percent} />
              <p className="mt-1 text-[11px] text-slate-400">
                {progress.total
                  ? `${progress.completed} of ${progress.total} tasks done`
                  : "No tasks on this project yet"}
              </p>
            </Fact>
          </div>

          {(data.assignedBy || project.description) && (
            <Card className="mt-4 p-5">
              {data.assignedBy && (
                <p className="text-xs text-slate-500">
                  Put on this project by{" "}
                  <span className="font-medium text-slate-700">{data.assignedBy}</span>
                  {data.assignedAt ? ` on ${fmt(data.assignedAt)}` : " — date not recorded"}
                </p>
              )}
              {project.description && (
                <p className="mt-2 text-sm whitespace-pre-wrap text-slate-700">
                  {project.description}
                </p>
              )}
            </Card>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === item.key
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 ring-inset hover:bg-slate-50"
                }`}
              >
                {item.label}
                <span
                  className={tab === item.key ? "ml-1.5 text-slate-300" : "ml-1.5 text-slate-400"}
                >
                  {counts[item.key]}
                </span>
              </button>
            ))}
          </div>

          <Card className="mt-3">
            {tab === "mine" && (
              <>
                <CardHeader title="My work" subtitle="Tasks on this project assigned to you" />
                <DataTable
                  columns={taskColumns(false)}
                  rows={data.myTasks}
                  emptyTitle="Nothing assigned to you yet"
                  emptyMessage="You are on this project, but no task on it is yours right now."
                />
              </>
            )}

            {tab === "files" && (
              <>
                <CardHeader
                  title="Files & archives"
                  subtitle="Everything handed over on this project, including ZIPs sent with a task"
                />
                <DataTable
                  columns={fileColumns}
                  rows={data.files}
                  emptyTitle="Nothing has been sent yet"
                  emptyMessage="Archives and documents your manager shares on this project appear here."
                />
              </>
            )}

            {tab === "board" && (
              <>
                <CardHeader
                  title="Whole board"
                  subtitle="What everybody else on the project is carrying"
                />
                <DataTable
                  columns={taskColumns(true)}
                  rows={data.teamTasks}
                  emptyTitle="No other tasks"
                  emptyMessage="Nothing on this project is assigned to anybody else."
                />
              </>
            )}

            {tab === "team" && (
              <>
                <CardHeader title="Team" subtitle="Who else is on this project" />
                <div className="divide-y divide-slate-100">
                  {!project.members?.length && (
                    <EmptyState
                      icon={UserRound}
                      title="Nobody else yet"
                      message="You are the only person on this project."
                    />
                  )}
                  {project.members?.map((person) => (
                    <div key={person._id} className="flex items-center gap-3 px-5 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                        {initialsOf(person.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{person.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {[person.designation, person.department].filter(Boolean).join(" · ") ||
                            "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "issues" && (
              <>
                <CardHeader title="Issues" subtitle="Raised against this project" />
                <div className="divide-y divide-slate-100">
                  {!data.issues.length && (
                    <EmptyState
                      icon={FileText}
                      title="No issues"
                      message="Nothing has been raised on this project."
                    />
                  )}
                  {data.issues.map((issue) => (
                    <div key={issue._id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-slate-800">{issue.title}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge value={issue.priority} />
                          <Badge value={issue.status} />
                        </div>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Raised by {issue.raisedBy?.name || "—"} · {prettify(issue.category || "")} ·{" "}
                        {fmt(issue.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
