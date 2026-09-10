import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Save, Play, Send, ClipboardList, AlertTriangle } from "lucide-react";

import employeeApi from "../employeeApi";
import { STATUS_COLORS, CHART } from "../../shared/theme";
import { prettify } from "../../shared/format";
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
  Textarea,
} from "../../shared/components/ui";

const todayInput = () => new Date().toISOString().slice(0, 10);

const SECTIONS = [
  { key: "dueToday", label: "Due today", tone: STATUS_COLORS.pending },
  { key: "inProgress", label: "In progress", tone: STATUS_COLORS.in_progress },
  { key: "overdue", label: "Overdue", tone: STATUS_COLORS.absent },
  { key: "submitted", label: "With your leader", tone: STATUS_COLORS.review },
];

export default function DailyWork() {
  const [date, setDate] = useState(todayInput());
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState({ hours: "", summary: "", blockers: "" });
  const [picked, setPicked] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/daily-work", { params: { date } })
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setForm({
          hours: res.log?.hours ?? "",
          summary: res.log?.summary ?? "",
          blockers: res.log?.blockers ?? "",
        });
        setPicked((res.log?.tasks || []).map((t) => t._id));
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load today's work");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [date, reloadKey]);

  const changeDate = (value) => {
    setLoading(true);
    setSuccess("");
    setDate(value);
  };

  const move = async (task, status) => {
    setBusyId(task._id);
    setError("");
    try {
      await employeeApi.put(`/employee/tasks/${task._id}`, { status });
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update the task");
    } finally {
      setBusyId("");
    }
  };

  const togglePicked = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const saveLog = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await employeeApi.post("/employee/daily-work", {
        date,
        hours: Number(form.hours) || 0,
        summary: form.summary,
        blockers: form.blockers,
        tasks: picked,
      });
      setSuccess("Work log saved");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save your work log");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading today's work..." />;

  // Every task the employee could tick off against this day
  const logCandidates = data
    ? [...data.dueToday, ...data.inProgress, ...data.overdue].filter(
        (task, i, list) => list.findIndex((t) => t._id === task._id) === i
      )
    : [];

  return (
    <div>
      <PageHeader
        title="Daily Work"
        subtitle="Move your tasks along and log what you actually did"
      >
        <Input
          type="date"
          value={date}
          onChange={(e) => changeDate(e.target.value)}
          className="w-auto"
        />
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {/* ------------------------------------------------------- counters */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SECTIONS.map((section) => (
          <Card key={section.key} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{section.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{data?.[section.key].length ?? 0}</p>
            <span
              className="mt-2 block h-1 w-8 rounded-full"
              style={{ background: section.tone }}
            />
          </Card>
        ))}
        <Card className="px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Attendance</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {data?.attendance ? prettify(data.attendance.status) : "Not marked"}
          </p>
          <span
            className="mt-2 block h-1 w-8 rounded-full"
            style={{
              background: data?.attendance
                ? STATUS_COLORS[data.attendance.status]
                : CHART.greyLight,
            }}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_400px]">
        {/* ----------------------------------------------------- task lists */}
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const tasks = data?.[section.key] || [];
            if (!tasks.length) return null;

            return (
              <Card key={section.key}>
                <CardHeader title={section.label} subtitle={`${tasks.length} tasks`} />
                <div className="divide-y divide-slate-100">
                  {tasks.map((task) => (
                    <div
                      key={task._id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/employee/tasks/details?id=${task._id}`}
                          className="truncate text-sm font-medium text-slate-900 hover:text-blue-600"
                        >
                          {task.title}
                        </Link>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          {task.project?.name || "No project"} ·{" "}
                          {task.dueDate
                            ? new Date(task.dueDate).toLocaleDateString("en-IN")
                            : "no due date"}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Badge value={task.priority} />
                        {task.status === "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busyId === task._id}
                            onClick={() => move(task, "in_progress")}
                          >
                            <Play size={13} />
                            Start
                          </Button>
                        )}
                        {task.status === "in_progress" && (
                          <Button
                            size="sm"
                            loading={busyId === task._id}
                            onClick={() => move(task, "review")}
                          >
                            <Send size={13} />
                            Submit
                          </Button>
                        )}
                        {task.status === "review" && <Badge value="review" />}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          {!SECTIONS.some((s) => data?.[s.key].length) && (
            <Card>
              <EmptyState
                icon={ClipboardList}
                title="Nothing on your plate"
                message="No tasks due, in progress or overdue for this date."
              />
            </Card>
          )}
        </div>

        {/* -------------------------------------------------------- the log */}
        <Card className="h-fit">
          <CardHeader
            title="Today's work log"
            subtitle="Your operations manager reads this — blockers get flagged to them"
          />
          <form onSubmit={saveLog}>
            <div className="space-y-4 p-5">
              <Field label="Hours worked" required>
                <Input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={form.hours}
                  onChange={(e) => setForm((prev) => ({ ...prev, hours: e.target.value }))}
                  placeholder="8"
                />
              </Field>

              <Field label="What did you do?" required>
                <Textarea
                  value={form.summary}
                  onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
                  rows={4}
                  required
                  placeholder="Completed the structural drawing revisions and shared them with the leader."
                />
              </Field>

              <Field
                label="Blockers"
                hint="Leave blank if nothing is holding you up — anything here pings your leader"
              >
                <Textarea
                  value={form.blockers}
                  onChange={(e) => setForm((prev) => ({ ...prev, blockers: e.target.value }))}
                  rows={2}
                  placeholder="Waiting on client approval for the revised layout."
                />
              </Field>

              {logCandidates.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-700">Tasks worked on</p>
                  <div className="max-h-44 space-y-1.5 overflow-y-auto">
                    {logCandidates.map((task) => (
                      <label
                        key={task._id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                          picked.includes(task._id)
                            ? "border-blue-600 bg-blue-50"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={picked.includes(task._id)}
                          onChange={() => togglePicked(task._id)}
                          className="h-4 w-4 accent-blue-600"
                        />
                        <span className="truncate text-xs text-slate-700">{task.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {data?.log?.blockers && (
                <p className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Your leader has been notified about the blocker on this log.
                </p>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 px-5 py-4">
              <Button type="submit" loading={saving}>
                <Save size={15} />
                {data?.log ? "Update log" : "Save log"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
