import { useCallback, useEffect, useState } from "react";
import { CalendarClock, MessageSquare, Star } from "lucide-react";

import hrApi from "../../hrApi";
import useHrAccess from "../../hooks/useHrAccess";
import DataTable from "../../../shared/components/DataTable";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import { INTERVIEW_OUTCOMES, shortDate, stageLabel } from "../../../shared/hr/constants";

/**
 * Every round, across every candidate, as one schedule.
 *
 * Rounds live inside the candidate — a round has no life without the person it
 * is for — which is right and makes "what is on this week" a question nothing
 * could answer. The server flattens them; this is where they are read and
 * where feedback goes back in.
 *
 * "Awaiting feedback" is the number worth watching: a round that happened and
 * was never written up is a decision nobody can make.
 */

const WHEN_OPTIONS = [
  { value: "upcoming", label: "Coming up" },
  { value: "past", label: "Already held" },
  { value: "unscheduled", label: "No date set" },
  { value: "all", label: "All rounds" },
];

const Stars = ({ value }) =>
  value ? (
    <span className="flex items-center gap-0.5 text-amber-500">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={11} fill={i < value ? "currentColor" : "none"} />
      ))}
    </span>
  ) : (
    <span className="text-xs text-slate-400">—</span>
  );

export default function Interviews() {
  const { can } = useHrAccess();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [when, setWhen] = useState("upcoming");
  const [outcome, setOutcome] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ outcome: "", feedback: "", rating: 0, scheduledAt: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/hiring/interviews", { params: { when, outcome: outcome || undefined } })
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load interviews"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [when, outcome, reloadKey]);

  const openEdit = (row) => {
    if (!can("hiring", "edit")) return;
    setEditing(row);
    setForm({
      outcome: row.outcome || "scheduled",
      feedback: row.feedback || "",
      rating: row.rating || 0,
      // datetime-local wants "YYYY-MM-DDTHH:mm" in local time
      scheduledAt: row.scheduledAt
        ? new Date(new Date(row.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "",
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await hrApi.put(`/hr/candidates/${editing.candidateId}/interviews/${editing._id}`, form);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save that round");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "candidate",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.candidate}</p>
          <p className="text-xs text-slate-400">
            {row.position || "—"}
            {row.opening ? ` · ${row.opening.code || row.opening.title}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "round",
      header: "Round",
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.round}</p>
          <p className="text-xs text-slate-400">{row.mode || "—"}</p>
        </div>
      ),
    },
    {
      key: "scheduledAt",
      header: "When",
      render: (row) =>
        row.scheduledAt ? (
          <div>
            <p className="text-slate-700">{shortDate(row.scheduledAt)}</p>
            <p className="text-[11px] text-slate-400">
              {new Date(row.scheduledAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        ) : (
          <span className="text-amber-600">Not scheduled</span>
        ),
    },
    {
      key: "interviewerName",
      header: "Interviewer",
      render: (row) => row.interviewerName || <span className="text-slate-400">Not decided</span>,
    },
    { key: "rating", header: "Rating", render: (row) => <Stars value={row.rating} /> },
    {
      key: "feedback",
      header: "Feedback",
      render: (row) =>
        row.feedback ? (
          <span className="line-clamp-2 max-w-[220px] text-slate-600">{row.feedback}</span>
        ) : (
          <span className="text-xs text-slate-400">Not written up</span>
        ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (row) => (
        <div>
          <Badge value={row.outcome} />
          <p className="mt-1 text-[11px] text-slate-400">{stageLabel(row.stage)}</p>
        </div>
      ),
    },
  ];

  const counts = data?.counts || {};

  return (
    <div>
      <PageHeader
        title="Interviews"
        subtitle={`${data?.total ?? 0} round${data?.total === 1 ? "" : "s"} in this view`}
      >
        <Select
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          options={WHEN_OPTIONS}
          className="w-auto"
        />
        <Select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          options={INTERVIEW_OUTCOMES}
          placeholder="Any outcome"
          className="w-auto min-w-[150px]"
        />
      </PageHeader>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Coming up
            </p>
            <p className="text-xl font-bold text-slate-900">{counts.upcoming ?? 0}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Awaiting feedback
            </p>
            <p
              className={`text-xl font-bold ${
                counts.awaitingFeedback > 0 ? "text-amber-600" : "text-slate-900"
              }`}
            >
              {counts.awaitingFeedback ?? 0}
            </p>
            <p className="text-[11px] text-slate-400">Held, and never written up</p>
          </div>
        </Card>
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          onRowClick={can("hiring", "edit") ? openEdit : undefined}
          emptyTitle="No interviews here"
          emptyMessage={
            when === "upcoming"
              ? "Nothing is scheduled from today. Add a round on a candidate."
              : "Nothing matches this view."
          }
        />
      </Card>

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <CalendarClock size={13} className="mt-0.5 shrink-0" />
        Rounds are scheduled from a candidate; this is where they are read back and written up.
        Once a candidate has passed their rounds, shortlist them from the Candidates list.
      </p>

      {/* ---------------------------------------------------- write it up */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Interview round"
        subtitle={editing ? `${editing.candidate} · ${editing.round}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <Alert>{formError}</Alert>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When">
              <Input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              />
            </Field>
            <Field label="Outcome">
              <Select
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                options={INTERVIEW_OUTCOMES}
              />
            </Field>
          </div>

          <Field label="Rating" hint="Out of 5 — zero means not rated">
            <Input
              type="number"
              min="0"
              max="5"
              value={form.rating}
              onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
            />
          </Field>

          <Field label="Feedback" hint="What the interviewer actually said">
            <Textarea
              rows={4}
              value={form.feedback}
              onChange={(e) => setForm({ ...form, feedback: e.target.value })}
            />
          </Field>

          <p className="flex items-start gap-2 text-[11px] text-slate-500">
            <MessageSquare size={12} className="mt-0.5 shrink-0" />
            Writing a round up does not move the candidate. Shortlist or reject them from the
            Candidates list when the rounds are done.
          </p>
        </form>
      </Modal>
    </div>
  );
}
