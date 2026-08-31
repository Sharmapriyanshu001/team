import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

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
  MultiSelect,
  PageHeader,
  Select,
} from "../../../shared/components/ui";
import { useConsoleOptions } from "./useConsoleOptions";
import { APP_STATUS } from "./constants";

const BLANK = {
  name: "",
  packageName: "",
  console: "",
  client: "",
  project: "",
  status: "draft",
  category: "",
  contentRating: "",
  storeUrl: "",
  employees: [],
};

export default function Apps() {
  const navigate = useNavigate();
  const crud = useCrud("play/apps");
  const lookups = useLookups();
  const consoleOptions = useConsoleOptions();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            console: row.console?._id || row.console || "",
            client: row.client?._id || "",
            project: row.project?._id || "",
            employees: (row.employees || []).map((u) => u._id || u),
          }
        : BLANK
    );
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, client: form.client || null, project: form.project || null };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this app");
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
      crud.setError(err.response?.data?.message || "Could not delete this app");
      setTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "App",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="font-mono text-xs text-slate-400">{row.packageName}</p>
        </div>
      ),
    },
    {
      key: "console",
      header: "Console",
      render: (row) => row.console?.name || <span className="text-slate-400">—</span>,
    },
    {
      key: "client",
      header: "Client",
      render: (row) => row.client?.name || <span className="text-slate-400">—</span>,
    },
    {
      key: "live",
      header: "Live version",
      render: (row) =>
        row.liveVersionName ? (
          <span className="text-slate-700">
            {row.liveVersionName}
            <span className="text-slate-400"> ({row.liveVersionCode})</span>
          </span>
        ) : (
          <span className="text-slate-400">Nothing live</span>
        ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.storeUrl && (
            <a
              href={row.storeUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open on Play"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ExternalLink size={15} />
            </a>
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

  return (
    <div>
      <PageHeader title="Apps" subtitle={`${crud.total} app${crud.total === 1 ? "" : "s"} across every console`}>
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          Add App
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by app or package name"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: APP_STATUS },
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
          onRowClick={(row) => navigate(`/admin/play/apps/${row._id}`)}
          emptyTitle="No apps yet"
          emptyMessage="Add an app to start tracking its releases, listing and policy notices."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit app" : "Add app"}
        subtitle={
          editing?._id
            ? "The store listing and releases live on the app's own page"
            : "The package name can never be changed after the first upload"
        }
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={saving}
              disabled={!form.name.trim() || !form.packageName.trim() || !form.console}
            >
              {editing?._id ? "Save changes" : "Add app"}
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App name" required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>

          <Field label="Package name" required hint="com.company.app — permanent once published">
            <Input
              value={form.packageName}
              onChange={(e) => setForm((f) => ({ ...f, packageName: e.target.value }))}
              placeholder="com.studio.app"
              className="font-mono"
            />
          </Field>

          <Field label="Console" required>
            <Select
              value={form.console}
              onChange={(e) => setForm((f) => ({ ...f, console: e.target.value }))}
              options={consoleOptions}
              placeholder="Which developer account"
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={APP_STATUS}
            />
          </Field>

          <Field label="Client">
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Nobody in particular"
            />
          </Field>

          <Field label="Project" hint="Links this app to the business project it was built under">
            <Select
              value={form.project}
              onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
              options={lookups.projectOptions}
              placeholder="Not linked"
            />
          </Field>

          <Field label="Category">
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Productivity"
            />
          </Field>

          <Field label="Content rating">
            <Input
              value={form.contentRating}
              onChange={(e) => setForm((f) => ({ ...f, contentRating: e.target.value }))}
              placeholder="e.g. Everyone"
            />
          </Field>

          <Field label="Store URL" className="sm:col-span-2">
            <Input
              value={form.storeUrl}
              onChange={(e) => setForm((f) => ({ ...f, storeUrl: e.target.value }))}
              placeholder="https://play.google.com/store/apps/details?id=…"
            />
          </Field>

          <Field label="Who works on it" className="sm:col-span-2">
            <MultiSelect
              options={lookups.employeeOptions}
              value={form.employees}
              onChange={(value) => setForm((f) => ({ ...f, employees: value }))}
              placeholder="Search employees…"
              emptyLabel="No employees on record"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this app?"
        message={`"${target?.name}" goes, and so does its whole release history and every policy notice filed against it. This cannot be undone.`}
        confirmLabel="Delete app"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />

      <p className="mt-4 text-xs text-slate-400">
        Open an app to edit its store listing and record releases.{" "}
        <Link to="/admin/play/consoles" className="text-blue-600 hover:underline">
          Manage consoles
        </Link>
      </p>
    </div>
  );
}
