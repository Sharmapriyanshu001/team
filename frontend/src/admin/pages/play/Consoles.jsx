import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Smartphone, ShieldAlert, TriangleAlert } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
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
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

const BLANK = {
  name: "",
  accountEmail: "",
  developerId: "",
  ownership: "studio",
  client: "",
  status: "active",
  registeredOn: "",
  appLimit: "",
  notes: "",
  operationsManagers: [],
  employees: [],
};

const OWNERSHIP = [
  { value: "studio", label: "Ours" },
  { value: "client", label: "Client's account" },
];

const STATUS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
  { value: "closed", label: "Closed" },
];

/** A number and what it counts, sized so a row of them reads as one band. */
function Stat({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    blue: "text-blue-700",
    amber: "text-amber-600",
    red: "text-red-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <Icon size={18} className="shrink-0 text-slate-400" />
      <div>
        <p className={`text-lg font-semibold leading-none ${tones[tone]}`}>{value}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function Consoles() {
  const crud = useCrud("play/consoles");
  const lookups = useLookups();

  const [overview, setOverview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    adminApi
      .get("/admin/play/overview")
      .then(({ data }) => setOverview(data))
      .catch(() => setOverview(null));
  }, [crud.rows]);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || "",
            registeredOn: row.registeredOn ? row.registeredOn.slice(0, 10) : "",
            appLimit: row.appLimit || "",
            operationsManagers: (row.operationsManagers || []).map((u) => u._id || u),
            employees: (row.employees || []).map((u) => u._id || u),
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
        appLimit: Number(form.appLimit) || 0,
        client: form.ownership === "client" ? form.client : null,
        registeredOn: form.registeredOn || null,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this console");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete this console");
      setTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Console",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.accountEmail || "no account email"}</p>
        </div>
      ),
    },
    {
      key: "ownership",
      header: "Belongs to",
      render: (row) =>
        row.ownership === "client" ? (
          <span className="text-slate-700">{row.client?.name || "a client"}</span>
        ) : (
          <span className="text-slate-500">Ours</span>
        ),
    },
    {
      key: "team",
      header: "Team",
      render: (row) => {
        const names = [...(row.operationsManagers || []), ...(row.employees || [])].map((u) => u.name);
        if (!names.length) return <span className="text-slate-400">Nobody yet</span>;
        return (
          <span className="text-slate-700">
            {names.slice(0, 2).join(", ")}
            {names.length > 2 && (
              <span className="text-slate-400"> +{names.length - 2}</span>
            )}
          </span>
        );
      },
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
        title="Play Consoles"
        subtitle={`${crud.total} developer account${crud.total === 1 ? "" : "s"}`}
      >
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          Add Console
        </Button>
      </PageHeader>

      {overview && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={ShieldAlert} label="Consoles" value={overview.consoles.total} />
          <Stat icon={Smartphone} label="Apps live" value={overview.apps.live} tone="blue" />
          <Stat
            icon={TriangleAlert}
            label="Policy notices open"
            value={overview.alerts.open}
            tone={overview.alerts.open ? "amber" : "slate"}
          />
          <Stat
            icon={TriangleAlert}
            label="Due within a week"
            value={overview.alerts.dueSoon}
            tone={overview.alerts.dueSoon ? "red" : "slate"}
          />
        </div>
      )}

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name, account email or developer id"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "Any status",
              options: STATUS,
            },
            {
              key: "ownership",
              value: crud.filters.ownership,
              placeholder: "Anyone's",
              options: OWNERSHIP,
            },
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
          emptyTitle="No consoles yet"
          emptyMessage="Add the developer accounts you publish from — then the apps that sit on them."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit console" : "Add console"}
        subtitle="A Google Play developer account and the people who work in it"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>
              {editing?._id ? "Save changes" : "Add console"}
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Console name" required className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Studio Main"
            />
          </Field>

          <Field
            label="Google account"
            hint="The email it signs in with. Never put the password here — that belongs in the vault."
          >
            <Input
              value={form.accountEmail}
              onChange={(e) => setForm((f) => ({ ...f, accountEmail: e.target.value }))}
              placeholder="publisher@studio.com"
            />
          </Field>

          <Field label="Developer ID" hint="The long number Play shows in account details">
            <Input
              value={form.developerId}
              onChange={(e) => setForm((f) => ({ ...f, developerId: e.target.value }))}
            />
          </Field>

          <Field label="Belongs to">
            <Select
              value={form.ownership}
              onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value }))}
              options={OWNERSHIP}
            />
          </Field>

          {form.ownership === "client" && (
            <Field label="Which client" required>
              <Select
                value={form.client}
                onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                options={lookups.clientOptions}
                placeholder="Pick a client"
              />
            </Field>
          )}

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={STATUS}
            />
          </Field>

          <Field label="Registered on">
            <Input
              type="date"
              value={form.registeredOn}
              onChange={(e) => setForm((f) => ({ ...f, registeredOn: e.target.value }))}
            />
          </Field>

          <Field label="App limit" hint="How many apps you are comfortable carrying here. 0 = no limit set.">
            <Input
              type="number"
              min="0"
              value={form.appLimit}
              onChange={(e) => setForm((f) => ({ ...f, appLimit: e.target.value }))}
            />
          </Field>

          <Field label="Operations Managers" hint="They see every app on this console" className="sm:col-span-2">
            <MultiSelect
              options={lookups.leaderOptions}
              value={form.operationsManagers}
              onChange={(value) => setForm((f) => ({ ...f, operationsManagers: value }))}
              placeholder="Search operations managers…"
              emptyLabel="No operations managers on record"
            />
          </Field>

          <Field
            label="Employees"
            hint="Console-wide access. Most people should be assigned to single apps instead."
            className="sm:col-span-2"
          >
            <MultiSelect
              options={lookups.employeeOptions}
              value={form.employees}
              onChange={(value) => setForm((f) => ({ ...f, employees: value }))}
              placeholder="Search employees…"
              emptyLabel="No employees on record"
            />
          </Field>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Anything worth remembering about this account"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this console?"
        message={`"${target?.name}" will be removed along with any policy notices filed against it. A console that still has apps on it cannot be deleted.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
