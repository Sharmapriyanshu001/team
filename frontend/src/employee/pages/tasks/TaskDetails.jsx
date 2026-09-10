import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks, Play, Send, RotateCcw, Star, ExternalLink } from "lucide-react";

import employeeApi from "../../employeeApi";
import { prettify } from "../../../shared/format";
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

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const isOverdue = (task) => {
  if (!task?.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

export default function TaskDetails() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id") || "";

  const [tasks, setTasks] = useState([]);
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /**
   * The slider's own value, held apart from the task's.
   *
   * Dragging a slider that writes straight through would fire a request per
   * pixel, so this holds what the person has dragged to and the Save button
   * commits it. Re-seeded from the task whenever a different one is opened —
   * otherwise the slider would still be showing the last task's figure.
   */
  const [progress, setProgress] = useState(0);

  // Task picker — everything assigned to this employee
  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/tasks", { params: { limit: 200 } })
      .then(({ data: res }) => {
        if (!active) return;
        setTasks(res.items || []);
        if (!selectedId && res.items?.length) {
          setParams({ id: res.items[0]._id }, { replace: true });
        }
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your tasks");
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
      .get(`/employee/tasks/${selectedId}`)
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setProgress(res.task?.progress ?? 0);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the task");
      })
      .finally(() => active && setLoadingDetail(false));

    return () => {
      active = false;
    };
  }, [selectedId, reloadKey]);

  const selectTask = (id) => {
    setLoadingDetail(true);
    setData(null);
    setSuccess("");
    setParams({ id });
  };

  /**
   * How far along, as this person reports it.
   *
   * Sent on its own, without a status. "I got another day into this" is the
   * commonest thing anybody has to say about a task and it moves no status —
   * the work was in progress yesterday and is in progress now. The server
   * starts a pending task on the first report, so pressing Save at 20% does
   * the obvious thing without a second click on Start working.
   */
  const saveProgress = async () => {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const { data: res } = await employeeApi.put(`/employee/tasks/${selectedId}`, {
        progress: Number(progress) || 0,
      });
      setSuccess(`Progress saved at ${res.item?.progress ?? progress}%`);
      setTasks((prev) => prev.map((t) => (t._id === selectedId ? { ...t, ...res.item } : t)));
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save your progress");
    } finally {
      setBusy(false);
    }
  };

  const move = async (status) => {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const { data: res } = await employeeApi.put(`/employee/tasks/${selectedId}`, { status });
      setSuccess(
        status === "review"
          ? "Submitted to your operations manager for review"
          : `Moved to ${prettify(status).toLowerCase()}`
      );
      setTasks((prev) => prev.map((t) => (t._id === selectedId ? { ...t, ...res.item } : t)));
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update the task");
    } finally {
      setBusy(false);
    }
  };

  if (loadingList) return <Loader />;

  if (!tasks.length) {
    return (
      <div>
        <PageHeader title="Task Details" />
        <Card>
          <EmptyState
            icon={ListChecks}
            title="No tasks assigned"
            message="Once your operations manager assigns you work it will show up here."
          />
        </Card>
      </div>
    );
  }

  const task = data?.task;
  const project = data?.project;

  const siblingColumns = [
    { key: "title", header: "Task", render: (row) => row.title },
    { key: "assignedTo", header: "Owner", render: (row) => row.assignedTo?.name || "Unassigned" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "dueDate", header: "Due", render: (row) => fmt(row.dueDate) },
  ];

  return (
    <div>
      <PageHeader title="Task Details" subtitle="Everything about one task in one place">
        <Select
          value={selectedId}
          onChange={(e) => selectTask(e.target.value)}
          options={tasks.map((t) => ({ value: t._id, label: t.title }))}
          className="w-auto min-w-[260px]"
        />
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {loadingDetail || !task ? (
        <Loader />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* ------------------------------------------------- the task */}
            <Card className="lg:col-span-2">
              <CardHeader
                title={task.title}
                subtitle={task.project?.name || "No project"}
                action={<Badge value={task.status} />}
              />

              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ["Priority", prettify(task.priority)],
                    ["Due", fmt(task.dueDate)],
                    ["Assigned by", task.assignedBy?.name || "Admin"],
                    ["Created", fmt(task.createdAt)],
                  ].map(([label, value], i) => (
                    <div key={label}>
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
                      <p
                        className={`mt-0.5 text-sm font-medium ${
                          i === 1 && isOverdue(task) ? "text-red-600" : "text-slate-800"
                        }`}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                    Description
                  </p>
                  <p className="text-sm text-slate-700">
                    {task.description || "No description was added for this task."}
                  </p>
                </div>

                {(task.reviewNote || task.reviewRating > 0) && (
                  <div className="rounded-lg bg-slate-50 p-4">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">
                      Operations Manager's review
                    </p>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={15}
                          className={
                            star <= (task.reviewRating || 0)
                              ? "fill-blue-600 text-blue-600"
                              : "text-slate-300"
                          }
                        />
                      ))}
                    </div>
                    {task.reviewNote && (
                      <p className="mt-2 text-sm italic text-slate-600">“{task.reviewNote}”</p>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* ---------------------------------------------------- actions */}
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Move this along"
                  subtitle="Only your operations manager can mark it completed"
                />
                <div className="space-y-3 p-5">
                  {/**
                   * Progress first, because it is the thing somebody opens
                   * this card to do most days. The status buttons below are
                   * for the two moments the job actually changes hands.
                   */}
                  {task.status !== "completed" && (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>How far along</span>
                        <span className="text-sm font-semibold text-slate-800">{progress}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={progress}
                        onChange={(e) => setProgress(Number(e.target.value))}
                        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
                      />
                      <Button
                        className="mt-2 w-full"
                        variant="outline"
                        loading={busy}
                        disabled={Number(progress) === Number(task.progress ?? 0)}
                        onClick={saveProgress}
                      >
                        Save progress
                      </Button>
                    </div>
                  )}

                  {task.bonus > 0 && (
                    <p
                      className={`rounded-lg px-3 py-2 text-xs ${
                        task.bonusAwardedAt
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {task.bonusAwardedAt
                        ? `Bonus of ₹${Number(task.bonus).toLocaleString("en-IN")} earned.`
                        : `₹${Number(task.bonus).toLocaleString(
                            "en-IN"
                          )} on this one once your operations manager approves it.`}
                    </p>
                  )}

                  {task.status === "pending" && (
                    <Button className="w-full" loading={busy} onClick={() => move("in_progress")}>
                      <Play size={15} />
                      Start working
                    </Button>
                  )}

                  {task.status === "in_progress" && (
                    <>
                      <Button className="w-full" loading={busy} onClick={() => move("review")}>
                        <Send size={15} />
                        Submit for review
                      </Button>
                      <Button
                        className="w-full"
                        variant="outline"
                        loading={busy}
                        onClick={() => move("pending")}
                      >
                        <RotateCcw size={15} />
                        Back to pending
                      </Button>
                    </>
                  )}

                  {task.status === "review" && (
                    <>
                      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        Submitted — waiting for your operations manager to sign it off.
                      </p>
                      <Button
                        className="w-full"
                        variant="outline"
                        loading={busy}
                        onClick={() => move("in_progress")}
                      >
                        <RotateCcw size={15} />
                        Pull back and keep working
                      </Button>
                    </>
                  )}

                  {task.status === "completed" && (
                    <p className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white">
                      Approved and closed. Nothing left to do here.
                    </p>
                  )}
                </div>
              </Card>

              {project && (
                <Card>
                  <CardHeader title="Project" subtitle={project.code || "No code"} />
                  <div className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                      <Badge value={project.status} />
                    </div>
                    <ProgressBar value={project.progress} />

                    <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Client</dt>
                        <dd className="truncate font-medium text-slate-800">
                          {project.client?.company || project.client?.name || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Operations Manager</dt>
                        <dd className="truncate font-medium text-slate-800">
                          {project.operationsManager?.name || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Deadline</dt>
                        <dd className="font-medium text-slate-800">{fmt(project.endDate)}</dd>
                      </div>
                    </dl>

                    <a
                      href="/employee/projects/active"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      All my projects
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card className="mt-4">
            <CardHeader
              title="Other work on this project"
              subtitle="What the rest of the team is doing"
            />
            <DataTable
              columns={siblingColumns}
              rows={data.siblings}
              emptyTitle="Nothing else here"
              emptyMessage="This is the only task on the project right now."
            />
          </Card>
        </>
      )}
    </div>
  );
}
