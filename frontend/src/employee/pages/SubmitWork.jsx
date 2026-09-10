import { useEffect, useState } from "react";
import { Check, X, Send, ClipboardCheck, CircleAlert } from "lucide-react";

import employeeApi from "../employeeApi";
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

const dedupe = (tasks) =>
  tasks.filter((task, i, list) => list.findIndex((t) => t._id === task._id) === i);

/**
 * End-of-day submission: every task the employee was given for the day is
 * marked done or not done in one pass, with a reason for whatever is left.
 * Done means "sent to the operations manager for review" — only they close a task.
 */
export default function SubmitWork() {
  const [date, setDate] = useState(todayInput());
  const [tasks, setTasks] = useState([]);
  const [alreadyLogged, setAlreadyLogged] = useState(false);

  // { [taskId]: { done: boolean, remark: string } }
  const [marks, setMarks] = useState({});
  const [form, setForm] = useState({ hours: "", blockers: "", summary: "" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    employeeApi
      .get("/employee/daily-work", { params: { date } })
      .then(({ data }) => {
        if (!active) return;

        const open = dedupe([...data.dueToday, ...data.inProgress, ...data.overdue]).filter(
          (task) => task.status !== "completed"
        );

        setTasks(open);
        setMarks(
          Object.fromEntries(
            open.map((task) => [
              task._id,
              // Anything already with the leader was finished earlier today
              { done: task.status === "review", remark: "" },
            ])
          )
        );
        setForm({
          hours: data.log?.hours ?? "",
          blockers: data.log?.blockers ?? "",
          summary: "",
        });
        setAlreadyLogged(Boolean(data.log));
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your tasks");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [date]);

  const mark = (id, done) =>
    setMarks((prev) => ({ ...prev, [id]: { ...prev[id], done } }));

  const setRemark = (id, remark) =>
    setMarks((prev) => ({ ...prev, [id]: { ...prev[id], remark } }));

  const doneCount = Object.values(marks).filter((m) => m.done).length;
  const pendingCount = tasks.length - doneCount;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data } = await employeeApi.post("/employee/daily-submit", {
        date,
        hours: Number(form.hours) || 0,
        blockers: form.blockers,
        summary: form.summary,
        entries: tasks.map((task) => ({
          task: task._id,
          done: marks[task._id].done,
          remark: marks[task._id].remark,
        })),
      });

      setSuccess(data.message);
      setAlreadyLogged(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit today's work");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading your tasks..." />;

  return (
    <div>
      <PageHeader
        title="Submit Today's Work"
        subtitle="Mark each task done or not done, then send it to your operations manager"
      >
        <Input
          type="date"
          value={date}
          onChange={(e) => {
            setSuccess("");
            setDate(e.target.value);
          }}
          className="w-auto"
        />
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {!tasks.length ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title="No open tasks for this date"
            message="Nothing due, in progress or overdue — nothing to submit."
          />
        </Card>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          {/* ------------------------------------------------ the task list */}
          <Card className="h-fit">
            <CardHeader
              title="Your tasks"
              subtitle={`${doneCount} done · ${pendingCount} not done`}
            />
            <div className="divide-y divide-slate-100">
              {tasks.map((task) => {
                const state = marks[task._id];

                return (
                  <div key={task._id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{task.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          {task.project?.name || "No project"} ·{" "}
                          {task.dueDate
                            ? `due ${new Date(task.dueDate).toLocaleDateString("en-IN")}`
                            : "no due date"}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Badge value={task.priority} />
                        <div className="flex overflow-hidden rounded-lg border border-slate-200">
                          <button
                            type="button"
                            onClick={() => mark(task._id, true)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                              state.done
                                ? "bg-blue-600 text-white"
                                : "bg-white text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            <Check size={13} />
                            Done
                          </button>
                          <button
                            type="button"
                            onClick={() => mark(task._id, false)}
                            className={`flex items-center gap-1.5 border-l border-slate-200 px-3 py-1.5 text-xs font-medium transition-colors ${
                              state.done
                                ? "bg-white text-slate-500 hover:bg-slate-50"
                                : "bg-slate-900 text-white"
                            }`}
                          >
                            <X size={13} />
                            Not done
                          </button>
                        </div>
                      </div>
                    </div>

                    <Input
                      value={state.remark}
                      onChange={(e) => setRemark(task._id, e.target.value)}
                      className="mt-3"
                      placeholder={
                        state.done
                          ? "Note for your leader (optional)"
                          : "Why is it not finished? (required)"
                      }
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ------------------------------------------------ the submission */}
          <Card className="h-fit">
            <CardHeader title="Wrap up the day" subtitle="This goes to your operations manager" />

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                  <p className="text-lg font-semibold text-slate-900">{doneCount}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Done</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                  <p className="text-lg font-semibold text-slate-900">{pendingCount}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Not done</p>
                </div>
              </div>

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

              <Field
                label="Summary"
                hint="Leave blank and we will write it from your ticks above"
              >
                <Textarea
                  value={form.summary}
                  onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
                  rows={3}
                  placeholder="Anything else your leader should know."
                />
              </Field>

              <Field label="Blockers" hint="Anything here is flagged to your leader">
                <Textarea
                  value={form.blockers}
                  onChange={(e) => setForm((prev) => ({ ...prev, blockers: e.target.value }))}
                  rows={2}
                  placeholder="Waiting on client approval for the revised layout."
                />
              </Field>

              <p className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                Tasks you mark done go to your operations manager for review — they close them.
              </p>
            </div>

            <div className="flex justify-end border-t border-slate-100 px-5 py-4">
              <Button type="submit" loading={saving}>
                <Send size={15} />
                {alreadyLogged ? "Submit again" : "Submit work"}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
