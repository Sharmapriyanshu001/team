import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, UserPlus, MessageSquarePlus } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
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
import { rupees } from "./billing";
import { LEAD_SOURCES, LEAD_STAGES } from "./constants";

const BLANK = {
  name: "",
  company: "",
  email: "",
  phone: "",
  city: "",
  source: "other",
  sourceDetail: "",
  requirement: "",
  stage: "new",
  estimatedValue: "",
  followUpOn: "",
  ownerName: "",
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;

/**
 * When to call them back, in words.
 *
 * The single column this screen exists for. A lead with a date in the past and
 * nothing shouting about it is a lead that has already gone cold.
 */
function FollowUp({ value, stage, now }) {
  if (["won", "lost"].includes(stage)) return <span className="text-slate-400">—</span>;
  if (!value) return <span className="text-amber-600">No date set</span>;

  const days = Math.ceil((new Date(value) - now) / 86400000);
  if (days < 0)
    return <span className="font-medium text-red-600">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="font-medium text-red-600">Today</span>;
  if (days <= 3) return <span className="font-medium text-amber-600">In {days}d</span>;
  return <span className="text-slate-500">{day(value)}</span>;
}

export default function Leads() {
  const crud = useCrud("crm/leads");

  const [now, setNow] = useState(() => Date.now());
  const [summary, setSummary] = useState(null);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [noting, setNoting] = useState(null);
  const [note, setNote] = useState({ body: "", followUpOn: "", stage: "" });

  const [converting, setConverting] = useState(null);
  const [target, setTarget] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    adminApi
      .get("/admin/crm/pipeline")
      .then(({ data }) => setSummary(data))
      .catch(() => setSummary(null));
  }, [crud.rows]);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            /**
             * Falls back to the linked account's name, so a lead assigned
             * from the sales panel opens with that name in the box rather
             * than with an empty one that reads as "nobody".
             */
            ownerName: row.ownerName || row.owner?.name || "",
            estimatedValue: row.estimatedValue || "",
            followUpOn: row.followUpOn ? row.followUpOn.slice(0, 10) : "",
          }
        : BLANK
    );
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        ...form,
        estimatedValue: Number(form.estimatedValue) || 0,
        followUpOn: form.followUpOn || null,
      };

      /**
       * The linked account is not this form's to set any more, and not its to
       * clear either. Sending nothing leaves whatever the sales panel assigned
       * exactly as it was — an admin correcting a phone number here must not
       * quietly take a lead off the rep chasing it.
       */
      delete payload.owner;
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this lead");
    } finally {
      setSaving(false);
    }
  };

  const logCall = async () => {
    try {
      await adminApi.post(`/admin/crm/leads/${noting._id}/notes`, {
        body: note.body,
        followUpOn: note.followUpOn || null,
        ...(note.stage ? { stage: note.stage } : {}),
      });
      setNoting(null);
      setNote({ body: "", followUpOn: "", stage: "" });
      crud.refresh();
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not save that note");
      setNoting(null);
    }
  };

  const convert = async () => {
    try {
      await adminApi.post(`/admin/crm/leads/${converting._id}/convert`, {});
      setConverting(null);
      crud.refresh();
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not convert this lead");
      setConverting(null);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Lead",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">
            {row.company || row.phone || row.email || "no contact details"}
          </p>
        </div>
      ),
    },
    { key: "source", header: "Came from", render: (row) => <Badge value={row.source} /> },
    {
      key: "estimatedValue",
      header: "Worth",
      className: "text-right",
      render: (row) =>
        row.estimatedValue ? (
          <span className="tabular-nums text-slate-900">{rupees(row.estimatedValue)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "followUpOn",
      header: "Call back",
      render: (row) => <FollowUp value={row.followUpOn} stage={row.stage} now={now} />,
    },
    {
      key: "owner",
      header: "Owner",
      // The typed name wins, because it is the one this screen can set.
      render: (row) => row.ownerName || row.owner?.name || "—",
    },
    { key: "stage", header: "Stage", render: (row) => <Badge value={row.stage} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setNoting(row);
              setNote({ body: "", followUpOn: "", stage: row.stage });
            }}
            title="Log a call"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <MessageSquarePlus size={15} />
          </button>
          {!row.convertedClient && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConverting(row);
              }}
              title="Convert to a client"
              className="rounded-md p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-700"
            >
              <UserPlus size={15} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              open(row);
            }}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
            title="Delete"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const openStages = LEAD_STAGES.filter((s) => !["won", "lost"].includes(s.value));
  const pipelineValue = openStages.reduce(
    (sum, stage) => sum + (summary?.stages?.[stage.value]?.value || 0),
    0
  );

  return (
    <div>
      <PageHeader title="Leads" subtitle="Who might buy, and when to call them back">
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          Add lead
        </Button>
      </PageHeader>

      {summary && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Pipeline value", rupees(pipelineValue), "across open leads", "slate"],
            [
              "Overdue follow-ups",
              summary.overdue,
              "should have been called",
              summary.overdue ? "red" : "slate",
            ],
            ["Due today", summary.dueToday, "call these", summary.dueToday ? "amber" : "slate"],
            ["Won this month", summary.wonThisMonth, "", "green"],
          ].map(([label, value, sub, tone]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p
                className={`text-xl font-semibold leading-none tabular-nums ${
                  { slate: "text-slate-900", red: "text-red-600", amber: "text-amber-600", green: "text-green-700" }[
                    tone
                  ]
                }`}
              >
                {value}
              </p>
              <p className="mt-1.5 text-xs text-slate-500">{label}</p>
              {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name, company, phone or requirement"
          onFilter={crud.setFilter}
          filters={[
            { key: "stage", value: crud.filters.stage, placeholder: "Any stage", options: LEAD_STAGES },
            { key: "source", value: crud.filters.source, placeholder: "Any source", options: LEAD_SOURCES },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={open}
          emptyTitle="No leads yet"
          emptyMessage="Add the enquiries that come in, and give each one a date to call back."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? editing.name : "Add lead"}
        subtitle={editing?.notes?.length ? `${editing.notes.length} note(s) on file` : ""}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Company">
            <Input
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Email" hint="Needed before this lead can become a client">
            <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </Field>
          <Field label="Came from">
            <Select
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              options={LEAD_SOURCES}
            />
          </Field>
          <Field label="Which one" hint="Whose referral, which marketplace">
            <Input
              value={form.sourceDetail}
              onChange={(e) => setForm((f) => ({ ...f, sourceDetail: e.target.value }))}
            />
          </Field>
          <Field label="Stage">
            <Select
              value={form.stage}
              onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
              options={LEAD_STAGES}
            />
          </Field>
          <Field label="Roughly worth">
            <Input
              type="number"
              min="0"
              value={form.estimatedValue}
              onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
            />
          </Field>
          <Field label="Call back on">
            <Input
              type="date"
              value={form.followUpOn}
              onChange={(e) => setForm((f) => ({ ...f, followUpOn: e.target.value }))}
            />
          </Field>
          <Field
            label="Owner"
            hint="A name for your own reference — it does not give anybody access to this lead"
            className="sm:col-span-2"
          >
            <Input
              value={form.ownerName}
              onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
              placeholder="Who is chasing this"
            />
          </Field>
          <Field label="What they want" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.requirement}
              onChange={(e) => setForm((f) => ({ ...f, requirement: e.target.value }))}
              placeholder="In their words"
            />
          </Field>
        </div>

        {editing?.notes?.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              What has been said
            </p>
            <div className="space-y-2">
              {[...editing.notes].reverse().map((entry) => (
                <div key={entry._id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-slate-700">{entry.body}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {entry.byName} · {day(entry.at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(noting)}
        title={`Log a call — ${noting?.name}`}
        subtitle="And set the next one, which is the part people forget"
        size="sm"
        onClose={() => setNoting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoting(null)}>
              Cancel
            </Button>
            <Button onClick={logCall} disabled={!note.body.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What was said" required>
            <Textarea
              rows={4}
              autoFocus
              value={note.body}
              onChange={(e) => setNote((n) => ({ ...n, body: e.target.value }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Call back on">
              <Input
                type="date"
                value={note.followUpOn}
                onChange={(e) => setNote((n) => ({ ...n, followUpOn: e.target.value }))}
              />
            </Field>
            <Field label="Move to stage">
              <Select
                value={note.stage}
                onChange={(e) => setNote((n) => ({ ...n, stage: e.target.value }))}
                options={LEAD_STAGES}
                placeholder="Leave as is"
              />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(converting)}
        title="Convert to a client?"
        message={`"${converting?.name}" becomes a real client record. Their phone number becomes the portal password, and the lead is kept so you can still see where the work came from.`}
        confirmLabel="Convert"
        variant="primary"
        onConfirm={convert}
        onClose={() => setConverting(null)}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this lead?"
        message={`"${target?.name}" and every note on them will be removed. Marking them lost keeps the record and is usually what you want.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await crud.remove(target._id);
          setTarget(null);
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
