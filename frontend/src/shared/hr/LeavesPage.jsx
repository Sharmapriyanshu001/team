import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Trash2, X } from "lucide-react";

import DataTable from "../components/DataTable";
import Toolbar from "../components/Toolbar";
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
import { LEAVE_STATUS, LEAVE_TYPES, dateInput, dateRange, leaveTypeLabel } from "./constants";

/**
 * Leave requests: filed, decided on, and counted.
 *
 * Approving is a route of its own rather than an edit, because it is the one
 * change that records who made it — so the decision dialog posts to
 * /leaves/:id/decide and the edit form deliberately has no status field.
 */

const BLANK = {
  employee: "",
  type: "casual",
  fromDate: "",
  toDate: "",
  reason: "",
};

export default function LeavesPage({ api, basePath, can, staffOptions = [], title, subtitle }) {

  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") || "");
  const [type, setType] = useState("");

  // Add / edit
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Decide
  const [deciding, setDeciding] = useState(null);
  const [decision, setDecision] = useState({ status: "approved", decisionNote: "" });

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .get(`${basePath}/leaves`, {
        params: { page, search: search || undefined, status: status || undefined, type: type || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load leave"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, page, search, status, type, reloadKey]);

  // Keep the status filter in the URL, so the overview can link straight to
  // "what is waiting for me" and a refresh does not lose it
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (status) next.set("status", status);
    else next.delete("status");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      employee: row.employee?._id || row.employee || "",
      type: row.type || "casual",
      fromDate: dateInput(row.fromDate),
      toDate: dateInput(row.toDate),
      reason: row.reason || "",
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (editing === "new") await api.post(`${basePath}/leaves`, form);
      else await api.put(`${basePath}/leaves/${editing}`, form);

      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this leave");
    } finally {
      setSaving(false);
    }
  };

  const decide = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await api.put(`${basePath}/leaves/${deciding._id}/decide`, decision);
      setDeciding(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not record that decision");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`${basePath}/leaves/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that leave");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "employee",
      header: "Who",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.employee?.name || "—"}</p>
          <p className="text-xs text-slate-400">
            {row.employee?.designation || row.employee?.department || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge value={row.type}>{leaveTypeLabel(row.type)}</Badge>,
    },
    { key: "dates", header: "Dates", render: (row) => dateRange(row.fromDate, row.toDate) },
    {
      key: "days",
      header: "Days",
      render: (row) => <span className="font-medium text-slate-900">{row.days ?? 0}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <span className="line-clamp-2 max-w-[240px] text-slate-600">{row.reason || "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div>
          <Badge value={row.status} />
          {row.decidedByName && (
            <p className="mt-1 text-[11px] text-slate-400">by {row.decidedByName}</p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {can("leaves", "edit") && row.status !== "approved" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeciding(row);
                setDecision({ status: "approved", decisionNote: "" });
                setFormError("");
              }}
              title="Approve"
              className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
            >
              <Check size={15} />
            </button>
          )}
          {can("leaves", "edit") && row.status !== "rejected" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeciding(row);
                setDecision({ status: "rejected", decisionNote: "" });
                setFormError("");
              }}
              title="Reject"
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <X size={15} />
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
      {/**
       * No "File Leave" button here.
       *
       * A leave request is something the person taking the leave asks for. It
       * arrives from their own panel and this screen is where it is answered —
       * approved or turned down. HR filing one on somebody's behalf created
       * requests the employee had never seen and could not withdraw, and made
       * "who actually asked for this" unanswerable at the one moment it
       * matters.
       */}
      <PageHeader title={title || "Leave Requests"} subtitle={subtitle || `${total} on record`} />

      <Alert>{error}</Alert>

      <Card>
        <Toolbar
          search={search}
          onSearch={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Search the reason or the decision note"
          onFilter={(key, value) => {
            setPage(1);
            if (key === "status") setStatus(value);
            if (key === "type") setType(value);
          }}
          filters={[
            {
              key: "status",
              value: status,
              placeholder: "All statuses",
              options: LEAVE_STATUS,
            },
            { key: "type", value: type, placeholder: "All types", options: LEAVE_TYPES },
          ]}
        />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          page={page}
          pages={pages}
          total={total}
          onPageChange={setPage}
          onRowClick={can("leaves", "edit") ? openEdit : undefined}
          emptyTitle="No leave to show"
          emptyMessage="Nothing matches these filters."
        />
      </Card>

      {/* ------------------------------------------------------ add / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "File a leave" : "Edit leave"}
        subtitle="The days are counted from the dates — a half day is always 0.5"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <Alert>{formError}</Alert>

          <Field label="Who is it for" required>
            <Select
              value={form.employee}
              onChange={(e) => setForm({ ...form, employee: e.target.value })}
              options={staffOptions}
              placeholder="Choose a person"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                options={LEAVE_TYPES}
              />
            </Field>
            <Field label="From" required>
              <Input
                type="date"
                value={form.fromDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    fromDate: e.target.value,
                    // A one-day leave is the common case, so the end follows
                    // the start until somebody moves it themselves
                    toDate: form.toDate && form.toDate >= e.target.value ? form.toDate : e.target.value,
                  })
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="To" required>
              <Input
                type="date"
                min={form.fromDate || undefined}
                value={form.toDate}
                onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                required
              />
            </Field>
          </div>

          <Field label="Reason">
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="What they said"
            />
          </Field>
        </form>
      </Modal>

      {/* -------------------------------------------------------- decision */}
      <Modal
        open={Boolean(deciding)}
        onClose={() => setDeciding(null)}
        title={decision.status === "approved" ? "Approve this leave" : "Reject this leave"}
        subtitle={
          deciding
            ? `${deciding.employee?.name || "Someone"} · ${dateRange(
                deciding.fromDate,
                deciding.toDate
              )} · ${deciding.days} day${deciding.days === 1 ? "" : "s"}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button onClick={decide} disabled={saving}>
              {saving ? "Saving…" : decision.status === "approved" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <form onSubmit={decide} className="space-y-3">
          <Alert>{formError}</Alert>

          <Field label="Decision">
            <Select
              value={decision.status}
              onChange={(e) => setDecision({ ...decision, status: e.target.value })}
              options={LEAVE_STATUS}
            />
          </Field>

          <Field label="Note" hint="Saved against the decision with your name on it">
            <Textarea
              rows={3}
              value={decision.decisionNote}
              onChange={(e) => setDecision({ ...decision, decisionNote: e.target.value })}
              placeholder="Optional"
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete leave"
        message={`Delete this leave for "${target?.employee?.name || "this person"}"? This cannot be undone.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
