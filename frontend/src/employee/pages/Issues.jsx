import { useState } from "react";
import { Plus, Pencil } from "lucide-react";

import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { readStoredUser } from "../../shared/createApi";
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

const EMPTY = { title: "", description: "", project: "", severity: "medium" };

export default function Issues() {
  const crud = useCrud("issues");
  const lookups = useLookups();
  const me = readStoredUser("employee");

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
      description: row.description || "",
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

  // Only issues this employee raised or owns can be edited
  const canEdit = (row) =>
    row.raisedBy?._id === me?.id || row.assignedTo?._id === me?.id;

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
    {
      key: "raisedBy",
      header: "Raised by",
      render: (row) =>
        row.raisedBy?._id === me?.id ? (
          <span className="font-medium text-blue-600">You</span>
        ) : (
          row.raisedBy?.name || "—"
        ),
    },
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
      render: (row) =>
        canEdit(row) ? (
          <button
            onClick={() => openEdit(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Issues"
        subtitle="Anything blocking work on your projects — raised issues go to your team leader"
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
              key: "view",
              value: crud.filters.view,
              placeholder: "All issues",
              options: [
                { value: "mine", label: "Raised by me" },
                { value: "assigned", label: "Assigned to me" },
              ],
            },
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: ["open", "in_progress", "resolved", "closed"],
            },
            {
              key: "severity",
              value: crud.filters.severity,
              placeholder: "All severities",
              options: SEVERITIES,
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
          emptyMessage="Report a blocker so your team leader can act on it."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing === "new" ? "Report issue" : "Update issue"}
        subtitle={
          editing === "new"
            ? "This goes straight to your team leader"
            : "You can update the details — closing it is your leader's call"
        }
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

          {editing === "new" && (
            <>
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
                  placeholder="Select a project"
                  options={lookups.projectOptions}
                />
              </Field>
            </>
          )}

          <Field label="Severity">
            <Select name="severity" value={form.severity} onChange={change} options={SEVERITIES} />
          </Field>

          {editing !== "new" && (
            <Field label="Status" hint="Only your team leader can close an issue">
              <Select
                name="status"
                value={form.status}
                onChange={change}
                options={["open", "in_progress", "resolved"]}
              />
            </Field>
          )}

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
