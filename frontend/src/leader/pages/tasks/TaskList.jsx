import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, Star } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import { useLeader } from "../../leaderContext";
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

const STATUSES = ["pending", "in_progress", "review", "completed"];
const PRIORITIES = ["low", "medium", "high"];

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

// Due dates are stored at midnight, so compare against the start of today.
const isOverdue = (task) => {
  if (!task.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

/** Shared by Assigned / Pending / Completed. */
export default function TaskList({ title, subtitle, baseFilters = {}, showRating = false }) {
  const crud = useCrud("tasks", { initialFilters: baseFilters });
  const lookups = useLookups();
  const { markTasksSeen } = useLeader();

  // Opening any task list is the leader looking, so the sidebar dot goes out
  useEffect(() => {
    markTasksSeen?.();
  }, [markTasksSeen]);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const openEdit = (row) => {
    setForm({
      title: row.title,
      description: row.description || "",
      project: row.project?._id || "",
      team: row.team?._id || "",
      assignedTo: row.assignedTo?._id || "",
      status: row.status,
      priority: row.priority,
      dueDate: toDateInput(row.dueDate),
      reviewNote: row.reviewNote || "",
      reviewRating: row.reviewRating || 0,
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
      await crud.update(editing._id, {
        ...form,
        reviewRating: Number(form.reviewRating) || 0,
      });
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the task");
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (row, status) => {
    try {
      await crud.update(row._id, { status });
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not update the task");
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete the task");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Task",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">
            {row.project?.name || row.team?.name || "No project"}
          </p>
        </div>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned to",
      render: (row) => row.assignedTo?.name || "Unassigned",
    },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Select
          value={row.status}
          options={STATUSES}
          onChange={(e) => quickStatus(row, e.target.value)}
          className="w-32 !py-1 !text-xs"
        />
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => (
        <span className={isOverdue(row) ? "font-medium text-red-600" : ""}>
          {row.dueDate ? new Date(row.dueDate).toLocaleDateString("en-IN") : "—"}
        </span>
      ),
    },
    ...(showRating
      ? [
          {
            key: "reviewRating",
            header: "Rating",
            render: (row) => (
              <span className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={13}
                    className={
                      star <= (row.reviewRating || 0)
                        ? "fill-blue-600 text-blue-600"
                        : "text-slate-300"
                    }
                  />
                ))}
              </span>
            ),
          },
        ]
      : []),
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
      <PageHeader title={title} subtitle={subtitle || `${crud.total} tasks`}>
        <Link to="/operation-manager/tasks/create">
          <Button>
            <Plus size={15} />
            Create Task
          </Button>
        </Link>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search tasks"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
            },
            {
              key: "assignedTo",
              value: crud.filters.assignedTo,
              placeholder: "Anyone",
              options: lookups.teamOptions,
            },
            ...(lookups.managesDepartment
              ? [
                  {
                    key: "team",
                    value: crud.filters.team,
                    placeholder: "All departments",
                    options: lookups.departmentOptions,
                  },
                ]
              : []),
            {
              key: "priority",
              value: crud.filters.priority,
              placeholder: "All priorities",
              options: PRIORITIES,
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
          emptyTitle="No tasks here"
          emptyMessage="Tasks matching this view will show up here."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title="Edit task"
        subtitle="You can only reassign work within your own team"
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
        {form && (
          <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Alert>{formError}</Alert>

            <Field label="Title" required className="sm:col-span-2">
              <Input name="title" value={form.title} onChange={change} required />
            </Field>

            {/* Department work has no project, so the field it belongs to is
                the one shown — swapping between the two is done on the full
                task form rather than here, where the point is a quick edit. */}
            {form.team && !form.project ? (
              <Field label="Department">
                <Select
                  name="team"
                  value={form.team}
                  onChange={change}
                  options={lookups.departmentOptions}
                />
              </Field>
            ) : (
              <Field label="Project">
                <Select
                  name="project"
                  value={form.project}
                  onChange={change}
                  options={lookups.projectOptions}
                />
              </Field>
            )}

            <Field label="Assign to">
              <Select
                name="assignedTo"
                value={form.assignedTo}
                onChange={change}
                placeholder="Unassigned"
                options={lookups.teamOptions}
              />
            </Field>

            <Field label="Status">
              <Select name="status" value={form.status} onChange={change} options={STATUSES} />
            </Field>

            <Field label="Priority">
              <Select name="priority" value={form.priority} onChange={change} options={PRIORITIES} />
            </Field>

            <Field label="Due date" className="sm:col-span-2">
              <Input name="dueDate" type="date" value={form.dueDate} onChange={change} />
            </Field>

            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" value={form.description} onChange={change} />
            </Field>

            {showRating && (
              <>
                <Field label="Review rating" hint="0 to 5">
                  <Input
                    name="reviewRating"
                    type="number"
                    min="0"
                    max="5"
                    value={form.reviewRating}
                    onChange={change}
                  />
                </Field>
                <Field label="Review note">
                  <Input name="reviewNote" value={form.reviewNote} onChange={change} />
                </Field>
              </>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete task"
        message={`Delete "${target?.title}"?`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
