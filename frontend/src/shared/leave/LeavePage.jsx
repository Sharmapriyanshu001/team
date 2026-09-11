import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Undo2 } from "lucide-react";

import DataTable from "../components/DataTable";
import Modal from "../components/Modal";
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

/**
 * Asking for time off, and seeing what HR said.
 *
 * The whole screen is one person's own requests. There is no approve control
 * anywhere on it and no route behind one — a decision is HR's, and the panel
 * not offering the button is the least of the reasons for that.
 *
 * What it does have to do well is close the loop: somebody who asked for three
 * days needs to see, without asking again, whether they got them. So the
 * decision and HR's note sit in the table beside each request rather than only
 * arriving as a notification that scrolls away.
 */

const EMPTY = { type: "casual", fromDate: "", toDate: "", reason: "" };

const prettify = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** A request that has not been decided is the only kind that can be taken back. */
const isPending = (row) => row?.status === "pending";

/**
 * Shared by the employee, operations manager and sales panels.
 *
 * `base` is the panel's API prefix — "/employee", "/leader", "/sales" — and
 * the two paths are built from it. One screen rather than three, because
 * asking for a day off is the same act whichever sidebar you asked from, and
 * three copies would be three places for the withdraw rule to drift.
 */
export default function LeavePage({ base, api, title = "My Leave", subtitle }) {
  const leavesPath = `${base}/leaves`;
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, cancelled: 0 });
  const [daysApproved, setDaysApproved] = useState(0);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const [withdrawing, setWithdrawing] = useState(null);

  /**
   * One fetch, re-run by bumping this rather than by calling it again.
   *
   * Applying and withdrawing both need the list back, and a `load()` they
   * could call would have to set state from inside the mount effect. A key the
   * effect depends on says the same thing without that.
   *
   * `loading` is only switched off, never on: it starts on, and blanking a
   * table that is already on screen for one round trip is a flicker rather
   * than feedback.
   */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;

    api
      .get(leavesPath)
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setDaysApproved(data.daysApproved || 0);
        setError("");
      })
      .catch((err) => {
        if (active) {
          setError(err.response?.data?.message || "Could not load your leave requests");
        }
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, leavesPath, reloadKey]);

  /**
   * The kinds of leave the company actually grants, rather than a list hard
   * coded here that drifts the moment HR edits a policy.
   */
  useEffect(() => {
    let active = true;
    api
      .get(`${base}/leave-policies`)
      .then(({ data }) => {
        if (!active) return;
        const fromPolicies = (data.items || []).map((p) => p.type);
        setTypes([...new Set(fromPolicies.length ? fromPolicies : data.types || [])]);
      })
      .catch(() => {
        // A failed lookup must not stop somebody applying — the server
        // validates the type either way.
        if (active) setTypes([]);
      });
    return () => {
      active = false;
    };
  }, [api, base]);

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const openApply = () => {
    setForm(EMPTY);
    setFormError("");
    setApplying(true);
  };

  const submit = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const { data } = await api.post(leavesPath, {
        ...form,
        // A single-day leave is the common case; not making somebody type the
        // same date twice is the whole of this line.
        toDate: form.toDate || form.fromDate,
      });
      setApplying(false);
      setNotice(data.message || "Your request has been sent");
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send that request");
    } finally {
      setSaving(false);
    }
  };

  const confirmWithdraw = async () => {
    if (!withdrawing) return;
    setSaving(true);
    try {
      await api.put(`${leavesPath}/${withdrawing._id}/withdraw`);
      setWithdrawing(null);
      setNotice("Request withdrawn");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not withdraw that request");
      setWithdrawing(null);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "type",
      header: "Leave",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{prettify(row.type)}</p>
          <p className="text-xs text-slate-500">
            {row.days} day{row.days === 1 ? "" : "s"}
          </p>
        </div>
      ),
    },
    {
      key: "dates",
      header: "Dates",
      render: (row) => (
        <div>
          <p className="text-slate-900">{formatDate(row.fromDate)}</p>
          {row.toDate && row.toDate !== row.fromDate && (
            <p className="text-xs text-slate-500">to {formatDate(row.toDate)}</p>
          )}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => <p className="max-w-xs text-slate-600">{row.reason || "—"}</p>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge value={row.status} />,
    },
    {
      /**
       * HR's answer, in the row it belongs to. A decision that only ever
       * appeared as a notification would be gone by the time somebody
       * wondered what happened.
       */
      key: "response",
      header: "HR's response",
      render: (row) => {
        if (isPending(row)) {
          return <span className="text-xs text-slate-400">Waiting for HR</span>;
        }
        return (
          <div>
            <p className="text-slate-700">{row.decisionNote || "—"}</p>
            <p className="text-xs text-slate-500">
              {row.decidedByName ? `${row.decidedByName}` : "HR"}
              {row.decidedAt ? ` · ${formatDate(row.decidedAt)}` : ""}
            </p>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        isPending(row) ? (
          <Button variant="ghost" size="sm" onClick={() => setWithdrawing(row)}>
            <Undo2 size={14} /> Withdraw
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={subtitle || "Apply for time off and follow what was decided"}
      >
        <Button onClick={openApply}>
          <CalendarPlus size={16} /> Apply for leave
        </Button>
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Pending", value: counts.pending || 0 },
          { label: "Approved", value: counts.approved || 0 },
          { label: "Rejected", value: counts.rejected || 0 },
          { label: "Days approved", value: daysApproved },
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="No leave requests yet"
          emptyMessage="When you apply for time off it will appear here, along with HR's decision."
        />
      </Card>

      {/* ------------------------------------------------------------ apply */}

      <Modal
        open={applying}
        title="Apply for leave"
        subtitle="This goes to HR for approval"
        onClose={() => setApplying(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApplying(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Sending…" : "Send request"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={submit}>
          {formError && <Alert>{formError}</Alert>}

          <Field label="Kind of leave" required>
            <Select
              name="type"
              value={form.type}
              onChange={change}
              options={(types.length ? types : ["casual"]).map((t) => ({
                value: t,
                label: prettify(t),
              }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" required>
              <Input type="date" name="fromDate" value={form.fromDate} onChange={change} required />
            </Field>
            <Field label="To" hint="Leave blank for a single day">
              <Input type="date" name="toDate" value={form.toDate} onChange={change} />
            </Field>
          </div>

          <Field label="Reason" required>
            <Textarea
              name="reason"
              rows={3}
              value={form.reason}
              onChange={change}
              placeholder="Why you need the time off"
              required
            />
          </Field>
        </form>
      </Modal>

      {/* --------------------------------------------------------- withdraw */}

      <Modal
        open={Boolean(withdrawing)}
        title="Withdraw this request?"
        onClose={() => setWithdrawing(null)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawing(null)} disabled={saving}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmWithdraw} disabled={saving}>
              {saving ? "Withdrawing…" : "Withdraw"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          HR has not decided this one yet. Withdrawing takes it off their list — you can always
          apply again.
        </p>
      </Modal>
    </div>
  );
}
