import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, TriangleAlert } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
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
import { useConsoleOptions } from "./useConsoleOptions";
import { ALERT_SEVERITY, ALERT_STATUS, ALERT_TYPES } from "./constants";

const BLANK = {
  title: "",
  detail: "",
  policyName: "",
  console: "",
  app: "",
  type: "warning",
  severity: "medium",
  status: "open",
  raisedOn: "",
  deadline: "",
  owner: "",
  resolution: "",
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

/**
 * The current time, as state rather than a call during render.
 *
 * Reading the clock while rendering is impure, and here it is also wrong: this
 * is a screen somebody leaves open, and a tab opened yesterday would go on
 * believing it is yesterday — quietly failing to call anything overdue on the
 * one morning that matters. Refreshed hourly, which is as fine-grained as a
 * countdown measured in days ever needs to be.
 */
function useNow() {
  // Lazy initialiser: read once on mount, not on every render
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/**
 * How long is left, in the words somebody would use out loud.
 *
 * A date on its own does not read as urgent — "12 Sep" and "2 Sep" look alike
 * in a table. This is the column that makes an overdue notice impossible to
 * scroll past.
 */
function Deadline({ value, status, now }) {
  if (!value) return <span className="text-slate-400">No deadline</span>;
  if (status === "resolved") return <span className="text-slate-400">{day(value)}</span>;

  const days = Math.ceil((new Date(value) - now) / 86400000);

  if (days < 0)
    return <span className="font-medium text-red-600">Overdue by {Math.abs(days)}d</span>;
  if (days === 0) return <span className="font-medium text-red-600">Today</span>;
  if (days <= 7) return <span className="font-medium text-amber-600">{days}d left</span>;
  return <span className="text-slate-500">{day(value)}</span>;
}

export default function PolicyAlerts() {
  const crud = useCrud("play/alerts");
  const lookups = useLookups();
  const consoleOptions = useConsoleOptions();
  const now = useNow();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            console: row.console?._id || "",
            app: row.app?._id || "",
            owner: row.owner?._id || "",
            raisedOn: row.raisedOn ? row.raisedOn.slice(0, 10) : "",
            deadline: row.deadline ? row.deadline.slice(0, 10) : "",
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
        console: form.console || null,
        app: form.app || null,
        owner: form.owner || null,
        raisedOn: form.raisedOn || null,
        deadline: form.deadline || null,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this notice");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete this notice");
      setTarget(null);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Notice",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title}</p>
          <p className="text-xs text-slate-400">
            {row.policyName || row.type.replace(/_/g, " ")}
            {row.app?.name ? ` · ${row.app.name}` : row.console?.name ? ` · ${row.console.name}` : ""}
          </p>
        </div>
      ),
    },
    { key: "severity", header: "Severity", render: (row) => <Badge value={row.severity} /> },
    {
      key: "deadline",
      header: "Deadline",
      render: (row) => <Deadline value={row.deadline} status={row.status} now={now} />,
    },
    {
      key: "owner",
      header: "Who is on it",
      render: (row) =>
        row.owner?.name || <span className="font-medium text-amber-600">Nobody</span>,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
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

  return (
    <div>
      <PageHeader
        title="Policy Notices"
        subtitle="Warnings, strikes and rejections from Google — and who is dealing with each one"
      >
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          Log a notice
        </Button>
      </PageHeader>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <TriangleAlert size={15} className="mt-px shrink-0 text-slate-400" />
        <p>
          A policy notice that nobody owns is how a developer account gets suspended — and a
          suspension takes every app on that console down at once. Give each one a person and a
          date.
        </p>
      </div>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search notices"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: ALERT_STATUS },
            { key: "severity", value: crud.filters.severity, placeholder: "Any severity", options: ALERT_SEVERITY },
            { key: "console", value: crud.filters.console, placeholder: "Any console", options: consoleOptions },
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
          emptyTitle="Nothing outstanding"
          emptyMessage="Log a notice the moment one arrives — the deadline is what matters."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit notice" : "Log a policy notice"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={saving}
              disabled={!form.title.trim() || (!form.console && !form.app)}
            >
              {editing?._id ? "Save changes" : "Log notice"}
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What Google said" required className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. App removed for Deceptive Behaviour"
            />
          </Field>

          <Field label="Console" hint="Pick a console, an app, or both">
            <Select
              value={form.console}
              onChange={(e) => setForm((f) => ({ ...f, console: e.target.value }))}
              options={consoleOptions}
              placeholder="Not console-wide"
            />
          </Field>

          <Field label="App">
            <Select
              value={form.app}
              onChange={(e) => setForm((f) => ({ ...f, app: e.target.value }))}
              options={[]}
              placeholder="Open the app's own page to link it"
              disabled
            />
          </Field>

          <Field label="Type">
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              options={ALERT_TYPES}
            />
          </Field>

          <Field label="Severity">
            <Select
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
              options={ALERT_SEVERITY}
            />
          </Field>

          <Field label="Policy name" hint="So two notices about the same policy are recognisable">
            <Input
              value={form.policyName}
              onChange={(e) => setForm((f) => ({ ...f, policyName: e.target.value }))}
              placeholder="e.g. Deceptive Behaviour"
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={ALERT_STATUS}
            />
          </Field>

          <Field label="Raised on">
            <Input
              type="date"
              value={form.raisedOn}
              onChange={(e) => setForm((f) => ({ ...f, raisedOn: e.target.value }))}
            />
          </Field>

          <Field label="Deadline" hint="The date the account is in trouble if nothing is done">
            <Input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            />
          </Field>

          <Field label="Who is on it" className="sm:col-span-2">
            <Select
              value={form.owner}
              onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              options={lookups.staffOptions}
              placeholder="Nobody yet — assign someone"
            />
          </Field>

          <Field label="Detail" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.detail}
              onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
              placeholder="Paste the notice, or the part of it that matters"
            />
          </Field>

          {form.status === "resolved" && (
            <Field label="How it was resolved" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.resolution}
                onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))}
              />
            </Field>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this notice?"
        message={`"${target?.title}" will be removed. If it is still open with Google, deleting the record does not make it go away.`}
        confirmLabel="Delete"
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
