import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
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
} from "../../shared/components/ui";

const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];

const EMPTY = {
  title: "",
  description: "",
  project: "",
  assignedTo: "",
  raisedBy: "",
  severity: "medium",
  status: "open",
};

export default function Issues() {
  const crud = useCrud("issues");
  const lookups = useLookups();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const openNew = () => {
    setForm(EMPTY);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (row) => {
    setForm({
      title: row.title,
      description: row.description || "",
      project: row.project?._id || "",
      assignedTo: row.assignedTo?._id || "",
      raisedBy: row.raisedBy?._id || "",
      severity: row.severity,
      status: row.status,
    });
    setFormError("");
    setEditing(row);
  };

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const payload = { ...form };
      // Stamp the resolution time when an issue is closed out
      if (["resolved", "closed"].includes(payload.status)) payload.resolvedAt = new Date();

      if (editing === "new") await crud.create(payload);
      else await crud.update(editing._id, payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the issue");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete the issue");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Issue",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">{row.project?.name || "No project"}</p>
        </div>
      ),
    },
    { key: "severity", header: "Severity", render: (row) => <Badge value={row.severity} /> },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "raisedBy", header: "Raised by", render: (row) => row.raisedBy?.name || "—" },
    { key: "assignedTo", header: "Owner", render: (row) => row.assignedTo?.name || "Unassigned" },
    {
      key: "createdAt",
      header: "Reported",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => openEdit(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setTarget(row)}
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
      <PageHeader title="Issues" subtitle={`${crud.total} issues logged across all projects`}>
        <Button onClick={openNew}>
          <Plus size={15} />
          Report Issue
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search issues"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: STATUSES,
            },
            {
              key: "severity",
              value: crud.filters.severity,
              placeholder: "All severities",
              options: SEVERITIES,
            },
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
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
          emptyTitle="No issues reported"
          emptyMessage="Site problems and blockers logged here stay visible until they are closed."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing === "new" ? "Report issue" : "Edit issue"}
        subtitle="Track blockers raised from site or by the client"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Alert>{formError}</Alert>

          <Field label="Title" required className="sm:col-span-2">
            <Input name="title" value={form.title} onChange={change} required placeholder="Cement delivery delayed" />
          </Field>

          <Field label="Project">
            <Select
              name="project"
              value={form.project}
              onChange={change}
              placeholder="No project"
              options={lookups.projectOptions}
            />
          </Field>

          <Field label="Severity">
            <Select name="severity" value={form.severity} onChange={change} options={SEVERITIES} />
          </Field>

          <Field label="Raised by">
            <Select
              name="raisedBy"
              value={form.raisedBy}
              onChange={change}
              placeholder="Not specified"
              options={lookups.staffOptions}
            />
          </Field>

          <Field label="Assign to">
            <Select
              name="assignedTo"
              value={form.assignedTo}
              onChange={change}
              placeholder="Unassigned"
              options={lookups.staffOptions}
            />
          </Field>

          <Field label="Status" className="sm:col-span-2">
            <Select name="status" value={form.status} onChange={change} options={STATUSES} />
          </Field>

          <Field label="Description" className="sm:col-span-2">
            <Textarea name="description" value={form.description} onChange={change} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete issue"
        message={`Delete "${target?.title}"?`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
