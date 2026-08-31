import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, IndianRupee } from "lucide-react";

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
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import LineItems from "./LineItems";
import { BLANK_LINE, rupees } from "./billing";
import { INVOICE_STATUS } from "./constants";

const BLANK = {
  client: "",
  project: "",
  title: "",
  lines: [{ ...BLANK_LINE }],
  discount: 0,
  status: "draft",
  dueOn: "",
  isRecurring: false,
  periodLabel: "",
  notes: "",
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—";

/** A due date only reads as urgent once it is spelled out in days. */
function Due({ value, status, now }) {
  if (["paid", "cancelled", "draft"].includes(status) || !value)
    return <span className="text-slate-400">{day(value)}</span>;

  const days = Math.ceil((new Date(value) - now) / 86400000);
  if (days < 0)
    return <span className="font-medium text-red-600">{Math.abs(days)}d overdue</span>;
  if (days <= 7) return <span className="font-medium text-amber-600">{days}d left</span>;
  return <span className="text-slate-500">{day(value)}</span>;
}

function Tile({ label, value, sub, tone = "slate" }) {
  const tones = { slate: "text-slate-900", red: "text-red-600", green: "text-green-700" };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className={`text-xl font-semibold leading-none tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const crud = useCrud("crm/invoices");
  const lookups = useLookups();

  const [now, setNow] = useState(() => Date.now());
  const [summary, setSummary] = useState(null);
  const [services, setServices] = useState([]);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [paying, setPaying] = useState(null);
  const [payment, setPayment] = useState({ amount: "", mode: "bank_transfer", reference: "" });
  const [payError, setPayError] = useState("");

  const [target, setTarget] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    adminApi
      .get("/admin/crm/receivables")
      .then(({ data }) => setSummary(data))
      .catch(() => setSummary(null));
  }, [crud.rows]);

  useEffect(() => {
    adminApi
      .get("/admin/crm/services", { params: { active: true, limit: 200 } })
      .then(({ data }) => setServices(data.items || []))
      .catch(() => setServices([]));
  }, []);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || row.client || "",
            project: row.project?._id || "",
            dueOn: row.dueOn ? row.dueOn.slice(0, 10) : "",
            lines: row.lines?.length ? row.lines : [{ ...BLANK_LINE }],
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
        project: form.project || null,
        dueOn: form.dueOn || null,
        discount: Number(form.discount) || 0,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this invoice");
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async () => {
    setPayError("");
    try {
      await adminApi.post(`/admin/crm/invoices/${paying._id}/payments`, {
        ...payment,
        amount: Number(payment.amount),
      });
      setPaying(null);
      setPayment({ amount: "", mode: "bank_transfer", reference: "" });
      crud.refresh();
    } catch (err) {
      setPayError(err.response?.data?.message || "Could not record that payment");
    }
  };

  const columns = [
    {
      key: "number",
      header: "Invoice",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.number}</p>
          <p className="text-xs text-slate-400">{row.title || day(row.issuedOn)}</p>
        </div>
      ),
    },
    {
      key: "client",
      header: "Billed to",
      render: (row) => row.billedTo?.company || row.client?.name || "—",
    },
    {
      key: "total",
      header: "Amount",
      className: "text-right",
      render: (row) => <span className="tabular-nums text-slate-900">{rupees(row.total)}</span>,
    },
    {
      key: "balance",
      header: "Outstanding",
      className: "text-right",
      render: (row) =>
        row.balance > 0 ? (
          <span className="tabular-nums font-medium text-slate-900">{rupees(row.balance)}</span>
        ) : (
          <span className="text-green-700">Settled</span>
        ),
    },
    {
      key: "dueOn",
      header: "Due",
      render: (row) => <Due value={row.dueOn} status={row.status} now={now} />,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {!["draft", "paid", "cancelled"].includes(row.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPaying(row);
                setPayment({ amount: row.balance, mode: "bank_transfer", reference: "" });
                setPayError("");
              }}
              title="Record a payment"
              className="rounded-md p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-700"
            >
              <IndianRupee size={15} />
            </button>
          )}
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

  const locked = editing?._id && editing.status !== "draft";

  return (
    <div>
      <PageHeader title="Invoices" subtitle={summary ? `Financial year ${summary.financialYear}` : ""}>
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          New invoice
        </Button>
      </PageHeader>

      {summary && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Outstanding"
            value={rupees(summary.outstanding.amount)}
            sub={`${summary.outstanding.count} invoices`}
          />
          <Tile
            label="Overdue"
            value={rupees(summary.overdue.amount)}
            sub={`${summary.overdue.count} past their due date`}
            tone={summary.overdue.amount > 0 ? "red" : "slate"}
          />
          <Tile
            label="Received this month"
            value={rupees(summary.receivedThisMonth)}
            tone="green"
          />
          <Tile
            label="Billed this month"
            value={rupees(summary.billedThisMonth.amount)}
            sub={summary.drafts ? `${summary.drafts} still in draft` : ""}
          />
        </div>
      )}

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by number or client"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: INVOICE_STATUS },
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
          onRowClick={(row) => navigate(`/admin/crm/invoices/${row._id}`)}
          emptyTitle="No invoices yet"
          emptyMessage="Raise one, or accept a quotation to turn it into an invoice."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? `Invoice ${editing.number}` : "New invoice"}
        subtitle={
          locked
            ? "This invoice has been issued — the amounts can no longer be changed"
            : "The number is allocated when you save"
        }
        size="lg"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.client}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="Client" required>
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Pick a client"
              disabled={Boolean(editing?._id)}
            />
          </Field>
          <Field label="Project">
            <Select
              value={form.project}
              onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
              options={lookups.projectOptions}
              placeholder="Not linked"
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={INVOICE_STATUS}
            />
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. March 2026 — SEO retainer"
            />
          </Field>
          <Field label="Due on">
            <Input
              type="date"
              value={form.dueOn}
              onChange={(e) => setForm((f) => ({ ...f, dueOn: e.target.value }))}
            />
          </Field>
        </div>

        {locked ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">{rupees(editing.total)}</p>
            <p className="mt-1 text-xs">
              {editing.lines?.length} line{editing.lines?.length === 1 ? "" : "s"} · already issued.
              To change what was billed, cancel this invoice and raise a new one.
            </p>
          </div>
        ) : (
          <LineItems
            lines={form.lines}
            onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            discount={form.discount}
            onDiscount={(discount) => setForm((f) => ({ ...f, discount }))}
            services={services}
          />
        )}

        <Field label="Notes" className="mt-4">
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </Field>
      </Modal>

      <Modal
        open={Boolean(paying)}
        title={`Record a payment — ${paying?.number}`}
        subtitle={paying ? `${rupees(paying.balance)} outstanding` : ""}
        size="sm"
        onClose={() => setPaying(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button onClick={recordPayment} disabled={!payment.amount}>
              Record
            </Button>
          </>
        }
      >
        <Alert>{payError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount received" required>
            <Input
              type="number"
              min="1"
              autoFocus
              value={payment.amount}
              onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label="How">
            <Select
              value={payment.mode}
              onChange={(e) => setPayment((p) => ({ ...p, mode: e.target.value }))}
              options={[
                { value: "upi", label: "UPI" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "cash", label: "Cash" },
                { value: "cheque", label: "Cheque" },
                { value: "card", label: "Card" },
                { value: "gateway", label: "Payment gateway" },
                { value: "other", label: "Other" },
              ]}
            />
          </Field>
          <Field label="Reference" hint="UTR, cheque number, gateway id" className="sm:col-span-2">
            <Input
              value={payment.reference}
              onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this invoice?"
        message={`${target?.number} and every payment recorded against it will be removed. If it has been sent to the client, cancel it instead — a deleted invoice leaves a gap in the numbering.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await crud.remove(target._id);
          setTarget(null);
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
