import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FolderKanban, Save, FileText, ExternalLink } from "lucide-react";

import leaderApi from "../../leaderApi";
import { prettify, money } from "../../../shared/format";
import DataTable from "../../../shared/components/DataTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
} from "../../../shared/components/ui";

const STATUSES = ["planning", "in_progress", "on_hold", "completed"];
const TABS = [
  { key: "tasks", label: "Tasks" },
  { key: "issues", label: "Issues" },
  { key: "files", label: "Files" },
  { key: "team", label: "Team" },
];

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");
export default function ProjectDetails() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id") || "";

  const [projects, setProjects] = useState([]);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("tasks");

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("planning");

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Project picker
  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/projects", { params: { limit: 200 } })
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

    leaderApi
      .get(`/leader/projects/${selectedId}`)
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setProgress(res.project.progress);
        setStatus(res.project.status);
        setSuccess("");
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the project");
      })
      .finally(() => active && setLoadingDetail(false));

    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectProject = (id) => {
    setLoadingDetail(true);
    setData(null);
    setParams({ id });
  };

  const saveProgress = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data: res } = await leaderApi.put(`/leader/projects/${selectedId}/progress`, {
        progress: Number(progress),
        status,
      });
      // The API returns the bare project, so merge it over the populated one.
      setData((prev) => ({ ...prev, project: { ...prev.project, ...res.item } }));
      setProgress(res.item.progress);
      setStatus(res.item.status);
      setProjects((prev) => prev.map((p) => (p._id === selectedId ? { ...p, ...res.item } : p)));
      setSuccess("Project updated");
    } catch (err) {
      setError(err.response?.data?.message || "Could not update the project");
    } finally {
      setSaving(false);
    }
  };

  if (loadingList) return <Loader />;

  if (!projects.length) {
    return (
      <div>
        <PageHeader title="Project Details" />
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            message="Once the admin assigns you a project it will show up here."
          />
        </Card>
      </div>
    );
  }

  const project = data?.project;

  const taskColumns = [
    { key: "title", header: "Task", render: (row) => row.title },
    { key: "assignedTo", header: "Assigned to", render: (row) => row.assignedTo?.name || "—" },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "dueDate", header: "Due", render: (row) => fmt(row.dueDate) },
  ];

  const issueColumns = [
    { key: "title", header: "Issue", render: (row) => row.title },
    { key: "severity", header: "Severity", render: (row) => <Badge value={row.severity} /> },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "raisedBy", header: "Raised by", render: (row) => row.raisedBy?.name || "—" },
    { key: "createdAt", header: "Reported", render: (row) => fmt(row.createdAt) },
  ];

  return (
    <div>
      <PageHeader title="Project Details" subtitle="Everything on one project in one place">
        <Select
          value={selectedId}
          onChange={(e) => selectProject(e.target.value)}
          options={projects.map((p) => ({
            value: p._id,
            label: p.code ? `${p.code} — ${p.name}` : p.name,
          }))}
          className="w-auto min-w-[220px]"
        />
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {loadingDetail || !project ? (
        <Loader />
      ) : (
        <>
          {/* ------------------------------------------------------ header */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title={project.name}
                subtitle={project.description || "No description"}
                action={<Badge value={project.status} />}
              />
              <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
                {[
                  ["Client", project.client?.company || project.client?.name || "—"],
                  ["Code", project.code || "—"],
                  ["Start", fmt(project.startDate)],
                  ["Deadline", fmt(project.endDate)],
                  ["Budget", money(project.budget)],
                  ["Priority", prettify(project.priority)],
                  ["Team size", `${project.members?.length || 0}`],
                  ["Tasks", `${data.tasks.length}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Update progress" subtitle="Keep the admin's dashboard honest" />
              <div className="space-y-4 p-5">
                <div>
                  <ProgressBar value={Number(progress) || 0} />
                </div>

                <Field label="Progress (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => setProgress(e.target.value)}
                  />
                </Field>

                <Field label="Status">
                  <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUSES} />
                </Field>

                <Button loading={saving} onClick={saveProgress} className="w-full">
                  <Save size={15} />
                  Save
                </Button>
              </div>
            </Card>
          </div>

          {/* -------------------------------------------------------- tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs opacity-60">
                  {t.key === "tasks"
                    ? data.tasks.length
                    : t.key === "issues"
                      ? data.issues.length
                      : t.key === "files"
                        ? data.files.length
                        : project.members?.length || 0}
                </span>
              </button>
            ))}
          </div>

          <Card className="mt-3">
            {tab === "tasks" && (
              <DataTable
                columns={taskColumns}
                rows={data.tasks}
                emptyTitle="No tasks yet"
                emptyMessage="Create tasks from the Tasks section."
              />
            )}

            {tab === "issues" && (
              <DataTable
                columns={issueColumns}
                rows={data.issues}
                emptyTitle="No issues"
                emptyMessage="Nothing blocking this project right now."
              />
            )}

            {tab === "files" && (
              <div className="divide-y divide-slate-100">
                {!data.files.length && (
                  <EmptyState
                    icon={FileText}
                    title="No files"
                    message="Attach drawings and reports from the Files section."
                  />
                )}
                {data.files.map((file) => (
                  <div key={file._id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <FileText size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{file.title}</p>
                      <p className="text-[11px] text-slate-400">
                        {prettify(file.category)} · {fmt(file.createdAt)}
                      </p>
                    </div>
                    {file.url && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === "team" && (
              <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {!project.members?.length && (
                  <p className="col-span-full py-8 text-center text-xs text-slate-400">
                    No members assigned to this project yet.
                  </p>
                )}
                {project.members?.map((member) => (
                  <div
                    key={member._id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                      {member.name
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{member.name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {member.designation || member.email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
