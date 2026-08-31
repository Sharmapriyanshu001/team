import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, Star } from "lucide-react";

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

const STATUSES = ["pending", "in_progress", "review", "completed"];
const PRIORITIES = ["low", "medium", "high"];

const EMPTY = {
  title: "",
  description: "",
  project: "",
  assignedTo: "",
  status: "pending",
  priority: "medium",
  dueDate: "",
  reviewNote: "",
  reviewRating: 0,
};

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

// Due dates are stored at midnight, so compare against the start of today —
// otherwise everything due today reads as overdue from 00:01 onwards.
const isOverdue = (task) => {
  if (!task.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

/**
 * One screen behind Daily / Pending / Completed / Reviews — each passes the
 * filters it needs and whether the review fields are shown.
 */
export default function TaskBoard({ title, subtitle, baseFilters = {}, review = false }) {
  // ?project=<id> lets other screens (the project drawer) land here pre-filtered
  const [params] = useSearchParams();
  const projectParam = params.get("project");

  const crud = useCrud("tasks", {
    initialFilters: projectParam ? { ...baseFilters, project: projectParam } : baseFilters,
  });
  const lookups = useLookups();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const openNew = () => {
    // Only carry over filters that are real task fields (e.g. status), not
    // view-only params like `due`.
    const prefill = Object.fromEntries(
      Object.entries(baseFilters).filter(([key]) => key in EMPTY)
    );
    setForm({ ...EMPTY, ...prefill });
    setFormError("");
    setEditing("new");
  };

  const openEdit = (row) => {
    setForm({
      title: row.title,
      description: row.description || "",
      project: row.project?._id || "",
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

  const change = (e) => {
    const { name, value } = e.target;

    setForm((prev) => {
      if (name !== "project") return { ...prev, [name]: value };

      // Switching project can orphan the assignee — drop them if they are not
      // on the new project's team.
      const next = lookups.projects.find((p) => String(p._id) === String(value));
      const team = next
        ? [next.teamLeader?._id, ...(next.members || []).map((m) => m._id)]
            .filter(Boolean)
            .map(String)
        : [];
      const keep = !value || team.includes(String(prev.assignedTo));

      return { ...prev, project: value, assignedTo: keep ? prev.assignedTo : "" };
    });
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const payload = { ...form, reviewRating: Number(form.reviewRating) || 0 };
      if (!payload.dueDate) delete payload.dueDate;

      if (editing === "new") await crud.create(payload);
      else await crud.update(editing._id, payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the task");
    } finally {
      setSaving(false);
    }
  };

  // Inline status change straight from the table
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

  /**
   * Work belongs to whoever is on the project, so the "Assign to" list follows
   * the project picked above: its team leader first, then its members. Without
   * a project there is nothing to narrow by, so the whole staff list stands.
   */
  const activeProject = lookups.projects.find((p) => String(p._id) === String(form.project));

  const projectTeam = activeProject
    ? [
        ...(activeProject.teamLeader
          ? [{ ...activeProject.teamLeader, role: "Team leader" }]
          : []),
        ...(activeProject.members || []).map((m) => ({ ...m, role: m.designation || "Employee" })),
      ]
    : [];

  const assignOptions = activeProject
    ? projectTeam.map((person) => ({
        value: person._id,
        label: `${person.name} — ${person.role}`,
      }))
    : lookups.staffOptions;

  const columns = [
    {
      key: "title",
      header: "Task",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">{row.project?.name || "No project"}</p>
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
    ...(review
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
        <Button onClick={openNew}>
          <Plus size={15} />
          Add Task
        </Button>
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
              options: lookups.employeeOptions,
            },
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
        title={editing === "new" ? "Add task" : "Edit task"}
        subtitle="Assign work to a team member against a project"
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
            <Input name="title" value={form.title} onChange={change} required placeholder="Prepare structural drawings" />
          </Field>

          <Field
            label="Project"
            hint={
              activeProject
                ? `Led by ${activeProject.teamLeader?.name || "nobody yet"}`
                : "Pick one to see only its team below"
            }
          >
            <Select
              name="project"
              value={form.project}
              onChange={change}
              placeholder="No project"
              options={lookups.projectOptions}
            />
          </Field>

          <Field
            label="Assign to"
            hint={
              !activeProject
                ? "Everyone on staff"
                : projectTeam.length
                  ? `${projectTeam.length} people on this project`
                  : "Nobody is on this project — add a team under Projects › Assign Team"
            }
          >
            <Select
              name="assignedTo"
              value={form.assignedTo}
              onChange={change}
              placeholder="Unassigned"
              options={assignOptions}
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

          {review && (
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
                <Input
                  name="reviewNote"
                  value={form.reviewNote}
                  onChange={change}
                  placeholder="Looks good, approved"
                />
              </Field>
            </>
          )}
        </form>
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
