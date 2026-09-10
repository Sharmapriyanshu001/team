import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import DataTable from "../components/DataTable";
import Modal, { ConfirmDialog } from "../components/Modal";
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
} from "../components/ui";
import { LEAVE_TYPES, leaveTypeLabel } from "./constants";

/**
 * How much of each kind of leave a year holds.
 *
 * One policy per type — the database enforces it with a unique index, so the
 * type dropdown leaves out types that are already spoken for rather than
 * offering a choice the save will refuse.
 */

const BLANK = {
  name: "",
  description: "",
  type: "casual",
  annualQuota: 0,
  carryForward: false,
  carryForwardCap: 0,
  maxConsecutiveDays: 0,
  noticeDays: 0,
  paid: true,
  active: true,
  notes: "",
};

export default function LeavePoliciesPage({ api, basePath, can, title, subtitle }) {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  /**
   * The finer rules start folded. Reset per open below rather than left as the
   * person last had it — opening the form to write a new policy should show
   * the short version even if the previous edit needed the long one.
   */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .get(`${basePath}/leave-policies`, { params: { limit: 200 } })
      .then(({ data }) => active && setRows(data.items || []))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load policies"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, reloadKey]);

  // Types already covered, so the form does not offer a clash it will refuse
  const takenTypes = new Set(
    rows.filter((row) => row._id !== editing).map((row) => row.type)
  );
  const typeOptions = LEAVE_TYPES.filter(
    (option) => !takenTypes.has(option.value) || option.value === form.type
  );

  const openAdd = () => {
    const firstFree = LEAVE_TYPES.find((option) => !takenTypes.has(option.value));
    setEditing("new");
    setForm({ ...BLANK, type: firstFree?.value || "other" });
    setFormError("");
    setShowAdvanced(false);
  };

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      name: row.name || "",
      description: row.description || "",
      type: row.type || "casual",
      annualQuota: row.annualQuota ?? 0,
      carryForward: Boolean(row.carryForward),
      carryForwardCap: row.carryForwardCap ?? 0,
      maxConsecutiveDays: row.maxConsecutiveDays ?? 0,
      noticeDays: row.noticeDays ?? 0,
      paid: row.paid !== false,
      active: row.active !== false,
      notes: row.notes || "",
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (editing === "new") await api.post(`${basePath}/leave-policies`, form);
      else await api.put(`${basePath}/leave-policies/${editing}`, form);

      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this policy");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`${basePath}/leave-policies/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that policy");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Policy",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{leaveTypeLabel(row.type)}</p>
        </div>
      ),
    },
    {
      key: "annualQuota",
      header: "Days a year",
      render: (row) =>
        row.annualQuota ? (
          <span className="font-medium text-slate-900">{row.annualQuota}</span>
        ) : (
          <span className="text-slate-400">Not capped</span>
        ),
    },
    {
      key: "carryForward",
      header: "Carry forward",
      render: (row) =>
        row.carryForward ? (
          <span className="text-slate-700">
            Yes{row.carryForwardCap ? ` · up to ${row.carryForwardCap}` : ""}
          </span>
        ) : (
          <span className="text-slate-400">No</span>
        ),
    },
    {
      key: "rules",
      header: "Rules",
      render: (row) => {
        const bits = [];
        if (row.maxConsecutiveDays) bits.push(`max ${row.maxConsecutiveDays} in a row`);
        if (row.noticeDays) bits.push(`${row.noticeDays} days notice`);
        return bits.length ? bits.join(" · ") : <span className="text-slate-400">None</span>;
      },
    },
    {
      key: "paid",
      header: "Paid",
      render: (row) => <Badge tone={row.paid ? "black" : "slate"}>{row.paid ? "Paid" : "Unpaid"}</Badge>,
    },
    {
      key: "active",
      header: "Status",
      render: (row) => (
        <Badge tone={row.active ? "blue" : "slate"}>{row.active ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {can("leaves", "edit") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row);
              }}
              title="Edit"
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            >
              <Pencil size={15} />
            </button>
          )}
          {can("leaves", "delete") && (
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
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={title || "Leave Policies"} subtitle={subtitle || `${rows.length} on record · one per leave type`}>
        {can("leaves", "create") && typeOptions.length > 0 && (
          <Button onClick={openAdd}>
            <Plus size={15} />
            Add Policy
          </Button>
        )}
      </PageHeader>

      <Alert>{error}</Alert>

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={can("leaves", "edit") ? openEdit : undefined}
          emptyTitle="No policies yet"
          emptyMessage="Add one to say how many days a year each kind of leave holds."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a leave policy" : "Edit policy"}
        subtitle="Name it and say what it is. The rules that govern it are optional."
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

          {/**
           * Three questions: what it is called, what it is, and anything HR
           * wants to remember about it. That is a whole policy for most
           * companies, and everything else is a rule some of them never set.
           *
           * Description and notes are not the same field. The description is
           * what an employee reads when choosing which kind of leave to ask
           * for; notes is HR's own aside. One box would have meant either
           * showing the aside to everybody or nobody writing the explanation.
           */}
          <Field label="Title" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Casual leave"
              required
            />
          </Field>

          <Field label="Description" hint="What employees see when they pick this kind of leave">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short breaks for personal work. Ask your manager a day ahead."
            />
          </Field>

          <Field label="Note" hint="HR's own aside — not shown to employees">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>

          {/**
           * Folded away rather than removed. A company that caps a run of
           * leave, or carries days into next year, still needs to say so —
           * they simply should not have to answer it to write an ordinary
           * policy.
           */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {showAdvanced ? "Hide" : "Show"} the finer rules — type, days a year, notice, carry
            forward
          </button>

          {showAdvanced && (
          <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" hint="One policy per type">
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                options={typeOptions}
              />
            </Field>
            <Field
              label="Days a year"
              hint="Leave Balances counts against this — at zero it has nothing to count"
            >
              <Input
                type="number"
                min="0"
                value={form.annualQuota}
                onChange={(e) => setForm({ ...form, annualQuota: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paid" hint="Unpaid leave is what drives a salary cut">
              <Select
                value={form.paid ? "yes" : "no"}
                onChange={(e) => setForm({ ...form, paid: e.target.value === "yes" })}
                options={[
                  { value: "yes", label: "Paid" },
                  { value: "no", label: "Unpaid" },
                ]}
              />
            </Field>
            <Field label="Max in a row">
              <Input
                type="number"
                min="0"
                value={form.maxConsecutiveDays}
                onChange={(e) => setForm({ ...form, maxConsecutiveDays: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notice days">
              <Input
                type="number"
                min="0"
                value={form.noticeDays}
                onChange={(e) => setForm({ ...form, noticeDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Carry forward">
              <Select
                value={form.carryForward ? "yes" : "no"}
                onChange={(e) => setForm({ ...form, carryForward: e.target.value === "yes" })}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ]}
              />
            </Field>
            <Field label="Carry forward cap" hint="Unused only when carry forward is off">
              <Input
                type="number"
                min="0"
                disabled={!form.carryForward}
                value={form.carryForwardCap}
                onChange={(e) => setForm({ ...form, carryForwardCap: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">
              <Select
                value={form.active ? "active" : "inactive"}
                onChange={(e) => setForm({ ...form, active: e.target.value === "active" })}
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
              />
            </Field>
          </div>

          </>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete policy"
        message={`Delete "${target?.name}"? Leave already taken is not affected, but the quota it granted stops counting.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
