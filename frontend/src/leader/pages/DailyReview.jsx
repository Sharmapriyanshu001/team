import { useEffect, useState } from "react";
import { ClipboardCheck, Check, RotateCcw, Star } from "lucide-react";

import leaderApi from "../leaderApi";
import { STATUS_COLORS, CHART } from "../../shared/theme";
import { prettify } from "../../shared/format";
import Modal from "../../shared/components/Modal";
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

const timeOf = (value) =>
  value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

function StarPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star === value ? 0 : star)}
          className="rounded p-0.5 hover:bg-slate-100"
        >
          <Star
            size={20}
            className={star <= value ? "fill-blue-600 text-blue-600" : "text-slate-300"}
          />
        </button>
      ))}
      <span className="ml-2 text-xs text-slate-500">{value ? `${value} / 5` : "Not rated"}</span>
    </div>
  );
}

export default function DailyReview() {
  const [date, setDate] = useState(todayInput());
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [reviewing, setReviewing] = useState(null);
  const [decision, setDecision] = useState("approve");
  const [rating, setRating] = useState(4);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/review", { params: { date } })
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the review queue");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [date, reloadKey]);

  const changeDate = (value) => {
    setLoading(true);
    setDate(value);
  };

  const openReview = (task, initialDecision) => {
    setReviewing(task);
    setDecision(initialDecision);
    setRating(task.reviewRating || (initialDecision === "approve" ? 4 : 0));
    setNote(task.reviewNote || "");
    setSuccess("");
  };

  const submitReview = async () => {
    setSaving(true);
    setError("");

    try {
      await leaderApi.put(`/leader/review/${reviewing._id}`, {
        decision,
        reviewRating: rating,
        reviewNote: note,
      });
      setSuccess(
        decision === "approve"
          ? `Approved "${reviewing.title}"`
          : `Sent "${reviewing.title}" back for rework`
      );
      setReviewing(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the review");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading today's work..." />;

  const activity = data?.activity || {};

  return (
    <div>
      <PageHeader
        title="Daily Work Review"
        subtitle="Sign off what your team submitted, or send it back with a note"
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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Awaiting review", data?.awaiting.length || 0, STATUS_COLORS.review],
          ["Completed today", data?.completedToday.length || 0, STATUS_COLORS.completed],
          ["In progress", activity.in_progress || 0, STATUS_COLORS.in_progress],
          ["Touched today", Object.values(activity).reduce((a, b) => a + b, 0), CHART.grey],
        ].map(([label, value, color]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
            <span className="mt-2 block h-1 w-8 rounded-full" style={{ background: color }} />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------- awaiting review */}
        <Card>
          <CardHeader
            title="Waiting for your sign-off"
            subtitle="Work your team marked as ready"
          />
          <div className="divide-y divide-slate-100">
            {!data?.awaiting.length && (
              <EmptyState
                icon={ClipboardCheck}
                title="All caught up"
                message="Nothing is waiting for review right now."
              />
            )}
            {data?.awaiting.map((task) => (
              <div key={task._id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{task.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {task.assignedTo?.name || "Unassigned"} · {task.project?.name || "No project"}
                    </p>
                  </div>
                  <Badge value={task.priority} />
                </div>

                {task.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => openReview(task, "approve")}>
                    <Check size={14} />
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openReview(task, "rework")}>
                    <RotateCcw size={14} />
                    Send back
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* --------------------------------------------- completed today */}
        <Card>
          <CardHeader
            title="Closed on this date"
            subtitle="What actually got finished"
          />
          <div className="divide-y divide-slate-100">
            {!data?.completedToday.length && (
              <EmptyState
                icon={ClipboardCheck}
                title="Nothing closed yet"
                message="Approved work will be listed here."
              />
            )}
            {data?.completedToday.map((task) => (
              <div key={task._id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {task.assignedTo?.name || "Unassigned"} · {task.project?.name || "—"}
                  </p>
                  {task.reviewNote && (
                    <p className="mt-1 text-[11px] italic text-slate-500">“{task.reviewNote}”</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        size={12}
                        className={
                          star <= (task.reviewRating || 0)
                            ? "fill-blue-600 text-blue-600"
                            : "text-slate-300"
                        }
                      />
                    ))}
                  </span>
                  <p className="mt-1 text-[10px] text-slate-400">{timeOf(task.completedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={Boolean(reviewing)}
        title={decision === "approve" ? "Approve work" : "Send back for rework"}
        subtitle={reviewing?.title}
        onClose={() => setReviewing(null)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "approve" ? "primary" : "dark"}
              loading={saving}
              onClick={submitReview}
            >
              {decision === "approve" ? "Approve" : "Send back"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {decision === "approve"
              ? "The task will be marked completed and the assignee notified."
              : "The task goes back to in progress and the assignee sees your note."}
          </div>

          <Field label="Rating">
            <StarPicker value={rating} onChange={setRating} />
          </Field>

          <Field
            label="Note"
            hint={decision === "approve" ? "Optional" : "Say what needs changing"}
          >
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                decision === "approve"
                  ? "Looks good, approved."
                  : "Please redo the section drawings with the revised levels."
              }
            />
          </Field>

          <p className="text-[11px] text-slate-400">
            Reviewing as {prettify(decision)} · {reviewing?.assignedTo?.name || "Unassigned"}
          </p>
        </div>
      </Modal>
    </div>
  );
}
