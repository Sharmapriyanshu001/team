import { useState } from "react";
import { Plus, Pencil } from "lucide-react";

import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal from "../../shared/components/Modal";
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
      if (editing === "new") await crud.create(form);
      else await crud.update(editing._id, form);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the issue");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Issue",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">{row.project?.name || "—"}</p>
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
        <button
          onClick={() => openEdit(row)}
          className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
        >
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Issues"
        subtitle={`${crud.total} issues on your projects — high and critical ones ping the admin`}
      >
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
          emptyTitle="No issues"
          emptyMessage="Report a blocker so it stays visible until it's closed."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing === "new" ? "Report issue" : "Update issue"}
        subtitle="Raise anything blocking delivery on one of your projects"
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
            <Input
              name="title"
              value={form.title}
              onChange={change}
              required
              placeholder="Cement delivery delayed by vendor"
            />
          </Field>

          <Field label="Project" required>
            <Select
              name="project"
              value={form.project}
              onChange={change}
              required
              disabled={editing !== "new"}
              placeholder="Select a project"
              options={lookups.projectOptions}
            />
          </Field>

          <Field label="Severity">
            <Select name="severity" value={form.severity} onChange={change} options={SEVERITIES} />
          </Field>

          <Field label="Assign to" hint="Your team only">
            <Select
              name="assignedTo"
              value={form.assignedTo}
              onChange={change}
              placeholder="Unassigned"
              options={lookups.myTeamOptions}
            />
          </Field>

          <Field label="Status">
            <Select name="status" value={form.status} onChange={change} options={STATUSES} />
          </Field>

          <Field label="Description" className="sm:col-span-2">
            <Textarea
              name="description"
              value={form.description}
              onChange={change}
              placeholder="What happened, what is blocked, and what you need."
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
