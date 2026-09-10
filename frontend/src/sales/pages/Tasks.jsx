import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";

import salesApi from "../salesApi";
import DataTable from "../../shared/components/DataTable";
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
import useNewTasks from "../hooks/useNewTasks";
import useSalesAccess from "../hooks/useSalesAccess";
import { prettify, shortDate } from "../constants";

/**
 * The work a sales manager hands to their team, and the work each of them has
 * been handed.
 *
 * One screen for both roles rather than two, because they are the same list
 * read from two ends — and a second screen is a second place for the status
 * vocabulary to drift. What changes by role is what the rows let you do: a
 * manager assigns, edits and deletes, an executive moves the status of their
 * own. The server decides that; `canAssign` in the list response is what it
 * says, and the buttons follow it rather than guessing from the role.
 */

const STATUSES = ["pending", "in_progress", "review", "completed"];
const PRIORITIES = ["low", "medium", "high"];

const STATUS_TONE = {
  pending: "slate",
  in_progress: "blue",
  review: "amber",
  completed: "green",
};

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "red" };

const BLANK = {
  title: "",
  description: "",
  assignedTo: "",
  priority: "medium",
  status: "pending",
  dueDate: "",
};

/** A date the <input type="date"> will accept, from whatever the API sent. */
const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/**
 * Overdue is a property of the row, not a status — a task can be "in progress"
 * and late at the same time, and colouring the status green-to-red would lose
 * one of those two facts.
 */
const isOverdue = (row) => {
  if (row.status === "completed" || !row.dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Due today is not late yet — the day is not over
  return new Date(row.dueDate) < today;
};

export default function Tasks() {
  const { isSalesHead } = useSalesAccess();
  const { markSeen } = useNewTasks();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [canAssign, setCanAssign] = useState(false);
  const [people, setPeople] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const isNew = editing === "new";

  /**
   * Opening this screen is what "I have seen the new work" means, so the dot
   * goes out here rather than on any particular row being read. Once per
   * mount — re-firing it on every filter change would be a write per keypress.
   */
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    salesApi
      .get("/sales/tasks", {
        params: {
          view: view === "all" ? undefined : view,
          status: status === "all" ? undefined : status,
          due: view === "overdue" ? "overdue" : undefined,
          search: search || undefined,
          limit: 100,
        },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setCanAssign(Boolean(data.canAssign));
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load tasks"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [view, status, search, reloadKey]);

  /**
   * The assign-to list. Fetched only for an account that can assign — an
   * executive has no use for it, and asking would be a request that exists
   * only to be ignored.
   */
  useEffect(() => {
    if (!isSalesHead) return;
    salesApi
      .get("/sales/people")
      .then(({ data }) => setPeople(data.items || []))
      .catch(() => setPeople([]));
  }, [isSalesHead]);

  const peopleOptions = useMemo(
    () => people.map((p) => ({ value: p._id, label: p.name })),
    [people]
  );

  const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const openNew = () => {
    setForm(BLANK);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (row) => {
    setForm({
      title: row.title || "",
      description: row.description || "",
      assignedTo: row.assignedTo?._id || "",
      priority: row.priority || "medium",
      status: row.status || "pending",
      dueDate: dateInput(row.dueDate),
    });
    setFormError("");
    setEditing(row);
  };

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (isNew) {
        const { data } = await salesApi.post("/sales/tasks", form);
        setNotice(data.message || "Task assigned");
      } else {
        await salesApi.put(`/sales/tasks/${editing._id}`, form);
        setNotice("Task updated");
      }
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  /**
   * The one edit an executive has. Sent as a status on its own rather than the
   * whole row, so it is the same request whichever role presses it — the
   * server ignores the rest for an assignee anyway.
   */
  const setStatusOn = async (row, next) => {
    try {
      await salesApi.put(`/sales/tasks/${row._id}`, { status: next });
      setNotice(next === "completed" ? `"${row.title}" marked done` : "Status updated");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update that task");
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      const { data } = await salesApi.delete(`/sales/tasks/${removing._id}`);
      setNotice(data.message || "Task deleted");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that task");
    } finally {
      setRemoving(null);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Task",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title}</p>
          {row.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "assignedTo",
      header: "With",
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.assignedTo?.name || "Unassigned"}</p>
          {row.assignedBy && (
            <p className="text-xs text-slate-500">from {row.assignedBy.name}</p>
          )}
        </div>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) =>
        row.dueDate ? (
          <span
            className={`inline-flex items-center gap-1 ${
              isOverdue(row) ? "font-medium text-red-600" : "text-slate-700"
            }`}
          >
            <CalendarClock size={13} /> {shortDate(row.dueDate)}
          </span>
        ) : (
          <span className="text-slate-400">No date</span>
        ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) => <Badge value={row.priority} tone={PRIORITY_TONE[row.priority]} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge value={prettify(row.status)} tone={STATUS_TONE[row.status] || "slate"} />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status !== "completed" && (
            <Select
              value=""
              onChange={(e) => e.target.value && setStatusOn(row, e.target.value)}
              placeholder="Move to…"
              className="w-32"
              options={STATUSES.filter((s) => s !== row.status).map((s) => ({
                value: s,
                label: prettify(s),
              }))}
            />
          )}
          {canAssign && (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                <Pencil size={13} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
                <Trash2 size={13} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSalesHead ? "Team tasks" : "My tasks"}
        subtitle={
          isSalesHead
            ? "What you have handed to your team, and where each of it stands"
            : "The work assigned to you"
        }
      >
        {canAssign && (
          <Button onClick={openNew}>
            <Plus size={16} /> Assign task
          </Button>
        )}
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Still open", value: counts.open ?? 0 },
          { label: "Overdue", value: counts.overdue ?? 0, warn: true },
          { label: "Completed", value: counts.completed ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                s.warn && s.value > 0 ? "text-red-600" : "text-slate-900"
              }`}
            >
              {s.value}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={view}
            onChange={(e) => setView(e.target.value)}
            className="w-44"
            options={[
              { value: "all", label: isSalesHead ? "Whole team" : "Everything" },
              { value: "open", label: "Still open" },
              { value: "overdue", label: "Overdue" },
              // A manager is somebody's assignee too — work the administrator
              // handed them lands in the same list as their team's.
              ...(isSalesHead ? [{ value: "mine", label: "Assigned to me" }] : []),
            ]}
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-40"
            options={[
              { value: "all", label: "Any status" },
              ...STATUSES.map((s) => ({ value: s, label: prettify(s) })),
            ]}
          />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="No tasks here"
          emptyMessage={
            canAssign
              ? "Assign a task and it appears on that person's own task screen straight away."
              : "Nothing has been assigned to you yet."
          }
        />
      </Card>

      {/* --------------------------------------------------------- the form */}

      <Modal
        open={Boolean(editing)}
        title={isNew ? "Assign a task" : `Edit "${editing?.title || ""}"`}
        subtitle={isNew ? "They are told about it as soon as you save" : undefined}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : isNew ? "Assign it" : "Save changes"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={save}>
          {formError && <Alert>{formError}</Alert>}

          <Field label="What needs doing" required>
            <Input name="title" value={form.title} onChange={change} required />
          </Field>

          <Field label="Detail" hint="Anything they need to know before they start">
            <Textarea name="description" rows={3} value={form.description} onChange={change} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Who it is for"
              required
              hint="Only people on your own team appear here"
            >
              <Select
                name="assignedTo"
                value={form.assignedTo}
                onChange={change}
                placeholder="Choose somebody"
                options={peopleOptions}
                required
              />
            </Field>
            <Field label="Due by">
              <Input type="date" name="dueDate" value={form.dueDate} onChange={change} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority">
              <Select
                name="priority"
                value={form.priority}
                onChange={change}
                options={PRIORITIES.map((p) => ({ value: p, label: prettify(p) }))}
              />
            </Field>
            {!isNew && (
              <Field label="Status">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={STATUSES.map((s) => ({ value: s, label: prettify(s) }))}
                />
              </Field>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(removing)}
        title="Delete this task?"
        onClose={() => setRemoving(null)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          &quot;{removing?.title}&quot; disappears from {removing?.assignedTo?.name || "their"}{" "}
          screen too, along with any record that it was asked for. If the work simply is not
          happening, marking it completed or leaving it open both say more than deleting it.
        </p>
      </Modal>
    </div>
  );
}
