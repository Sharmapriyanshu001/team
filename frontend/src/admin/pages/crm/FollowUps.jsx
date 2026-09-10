import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, PhoneCall } from "lucide-react";

import adminApi from "../../adminApi";
import usePermissions from "../../hooks/usePermissions";
import DataTable from "../../../shared/components/DataTable";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import { LEAD_STAGES } from "./constants";

/**
 * Who to call today.
 *
 * A lead with no next date is one that will be remembered by accident or not
 * at all, which is why Lead.followUpOn exists and why this screen sorts by it.
 * The three buckets are the only ones that matter on a given morning: what is
 * late, what is today, and what is coming.
 *
 * Logging a call is the same call the pipeline uses — POST a note, which also
 * sets the next date and can move the stage. One action, because in practice
 * they are one action.
 */

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));
const endOfToday = () => new Date(new Date().setHours(23, 59, 59, 999));

const longDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const EMPTY_MESSAGES = {
  overdue: "Nothing has been missed.",
  unscheduled: "Every open lead has a date to call back on.",
  today: "Nothing due today.",
  upcoming: "Nothing scheduled yet.",
};

/**
 * One bucket of leads.
 *
 * Declared here rather than inside FollowUps on purpose: a component defined
 * during a render is a *new* component type on every render, so React unmounts
 * and remounts the whole subtree each time — which, with a DataTable inside,
 * throws away its paging on every keystroke.
 */
const Section = ({ title, subtitle, rows, tone, columns, loading, onRowClick }) => (
  <Card className="mb-4">
    <CardHeader title={title} subtitle={subtitle} />
    <DataTable
      columns={columns}
      rows={rows}
      loading={loading}
      onRowClick={onRowClick}
      emptyTitle="Nothing here"
      emptyMessage={EMPTY_MESSAGES[tone]}
    />
  </Card>
);

export default function FollowUps() {
  const { can } = usePermissions();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [logging, setLogging] = useState(null);
  const [note, setNote] = useState({ body: "", followUpOn: "", stage: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    /**
     * The whole open pipeline in one request, bucketed here rather than in
     * three. A studio's pipeline is tens of leads, not thousands — three round
     * trips to slice a list this size costs more than it saves.
     */
    adminApi
      .get("/admin/crm/leads", { params: { limit: 200 } })
      .then(({ data }) => active && setLeads(data.items || []))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load leads"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const buckets = useMemo(() => {
    const open = leads.filter((lead) => !["won", "lost"].includes(lead.stage));
    const today = startOfToday();
    const tonight = endOfToday();

    const dated = open.filter((lead) => lead.followUpOn);

    return {
      overdue: dated.filter((lead) => new Date(lead.followUpOn) < today),
      today: dated.filter((lead) => {
        const at = new Date(lead.followUpOn);
        return at >= today && at <= tonight;
      }),
      upcoming: dated.filter((lead) => new Date(lead.followUpOn) > tonight),
      // The dangerous ones: in play, and nobody has said when to call back
      unscheduled: open.filter((lead) => !lead.followUpOn),
    };
  }, [leads]);

  const logCall = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await adminApi.post(`/admin/crm/leads/${logging._id}/notes`, {
        body: note.body,
        followUpOn: note.followUpOn || null,
        ...(note.stage ? { stage: note.stage } : {}),
      });
      setLogging(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not log that call");
    } finally {
      setSaving(false);
    }
  };

  const openLog = (lead) => {
    setLogging(lead);
    setNote({ body: "", followUpOn: dateInput(lead.followUpOn), stage: lead.stage || "" });
    setFormError("");
  };

  const columnsFor = (tone) => [
    {
      key: "name",
      header: "Lead",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.company || row.email || row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "requirement",
      header: "Wants",
      render: (row) => (
        <span className="line-clamp-2 max-w-[240px] text-slate-600">{row.requirement || "—"}</span>
      ),
    },
    {
      key: "estimatedValue",
      header: "Value",
      render: (row) =>
        row.estimatedValue ? (
          <span className="font-medium text-slate-900">
            ₹{Number(row.estimatedValue).toLocaleString("en-IN")}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "stage", header: "Stage", render: (row) => <Badge value={row.stage} /> },
    { key: "owner", header: "Owner", render: (row) => row.owner?.name || "—" },
    {
      key: "followUpOn",
      header: "Call back",
      render: (row) => (
        <span
          className={
            tone === "overdue" ? "font-semibold text-red-600" : tone === "today" ? "font-semibold text-slate-900" : "text-slate-600"
          }
        >
          {row.followUpOn ? longDate(row.followUpOn) : "Not set"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        can("crm", "edit") && (
          <Button
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              openLog(row);
            }}
          >
            <PhoneCall size={14} />
            Log call
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        subtitle="Who to call, and when — every open lead sorted by its call-back date"
      />

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Overdue", buckets.overdue.length, "text-red-600"],
          ["Today", buckets.today.length, "text-slate-900"],
          ["Coming up", buckets.upcoming.length, "text-slate-900"],
          ["No date set", buckets.unscheduled.length, "text-amber-600"],
        ].map(([label, value, colour]) => (
          <Card key={label}>
            <div className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className={`text-xl font-bold ${colour}`}>{value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Section
        title="Overdue"
        subtitle="The call-back date has gone by"
        rows={buckets.overdue}
        tone="overdue"
        columns={columnsFor("overdue")}
        loading={loading}
        onRowClick={can("crm", "edit") ? openLog : undefined}
      />
      <Section
        title="Today"
        subtitle="Due today"
        rows={buckets.today}
        tone="today"
        columns={columnsFor("today")}
        loading={loading}
        onRowClick={can("crm", "edit") ? openLog : undefined}
      />
      <Section
        title="No date set"
        subtitle="In play, with nobody saying when to call back — these are the ones that go cold"
        rows={buckets.unscheduled}
        tone="unscheduled"
        columns={columnsFor("unscheduled")}
        loading={loading}
        onRowClick={can("crm", "edit") ? openLog : undefined}
      />
      <Section
        title="Coming up"
        subtitle="Scheduled for later"
        rows={buckets.upcoming}
        tone="upcoming"
        columns={columnsFor("upcoming")}
        loading={loading}
        onRowClick={can("crm", "edit") ? openLog : undefined}
      />

      {/* --------------------------------------------------------- log a call */}
      <Modal
        open={Boolean(logging)}
        onClose={() => setLogging(null)}
        title="Log a call"
        subtitle={logging ? `${logging.name}${logging.company ? ` — ${logging.company}` : ""}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setLogging(null)}>
              Cancel
            </Button>
            <Button onClick={logCall} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={logCall} className="space-y-3">
          <Alert>{formError}</Alert>

          {logging?.notes?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Said so far
              </p>
              <ul className="space-y-2">
                {logging.notes.slice(-5).reverse().map((entry) => (
                  <li key={entry._id} className="border-l-2 border-slate-300 pl-2.5">
                    <p className="text-xs text-slate-700">{entry.body}</p>
                    <p className="text-[11px] text-slate-400">
                      {entry.byName || "Someone"} · {longDate(entry.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="What was said" required>
            <Textarea
              rows={3}
              value={note.body}
              onChange={(e) => setNote({ ...note, body: e.target.value })}
              placeholder="Spoke to them, wants a revised quote by Friday"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Call back on"
              hint="Leave blank to clear the date — but then nothing will remind anybody"
            >
              <Input
                type="date"
                value={note.followUpOn}
                onChange={(e) => setNote({ ...note, followUpOn: e.target.value })}
              />
            </Field>
            <Field label="Stage" hint="Moving it on is usually part of the same call">
              <Select
                value={note.stage}
                onChange={(e) => setNote({ ...note, stage: e.target.value })}
                options={LEAD_STAGES}
              />
            </Field>
          </div>

          <p className="flex items-start gap-2 text-[11px] text-slate-500">
            <CalendarClock size={13} className="mt-0.5 shrink-0" />
            The note is saved against the lead with your name on it, and the pipeline picks up the
            new date immediately.
          </p>
        </form>
      </Modal>
    </div>
  );
}
