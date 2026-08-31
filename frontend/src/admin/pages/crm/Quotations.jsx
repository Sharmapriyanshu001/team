import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, FileOutput, Settings2 } from "lucide-react";

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
import RateCard from "./RateCard";
import { BLANK_LINE, rupees } from "./billing";
import { QUOTATION_STATUS } from "./constants";

const BLANK = {
  client: "",
  lead: "",
  title: "",
  lines: [{ ...BLANK_LINE }],
  discount: 0,
  status: "draft",
  validUntil: "",
  notes: "",
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—";

export default function Quotations() {
  const navigate = useNavigate();
  const crud = useCrud("crm/quotations");
  const lookups = useLookups();

  const [services, setServices] = useState([]);
  const [leadOptions, setLeadOptions] = useState([]);
  const [rateCardOpen, setRateCardOpen] = useState(false);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [converting, setConverting] = useState(null);
  const [convertError, setConvertError] = useState("");
  const [target, setTarget] = useState(null);

  const loadServices = () => {
    adminApi
      .get("/admin/crm/services", { params: { active: true, limit: 200 } })
      .then(({ data }) => setServices(data.items || []))
      .catch(() => setServices([]));
  };

  useEffect(loadServices, []);

  useEffect(() => {
    adminApi
      .get("/admin/crm/leads", { params: { limit: 100 } })
      .then(({ data }) =>
        setLeadOptions(
          (data.items || [])
            .filter((lead) => !lead.convertedClient)
            .map((lead) => ({
              value: lead._id,
              label: lead.company ? `${lead.name} — ${lead.company}` : lead.name,
            }))
        )
      )
      .catch(() => setLeadOptions([]));
  }, []);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || "",
            lead: row.lead?._id || "",
            validUntil: row.validUntil ? row.validUntil.slice(0, 10) : "",
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
        client: form.client || null,
        lead: form.lead || null,
        validUntil: form.validUntil || null,
        discount: Number(form.discount) || 0,
      };

      if (editing?._id) {
        const { data } = await adminApi.put(`/admin/crm/quotations/${editing._id}`, payload);
        crud.refresh();
        setEditing(null);
        return data;
      }
      await crud.create(payload);
      setEditing(null);
      return null;
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this quotation");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const raiseInvoice = async () => {
    setConvertError("");
    try {
      const { data } = await adminApi.post(
        `/admin/crm/quotations/${converting._id}/invoice`,
        {}
      );
      setConverting(null);
      crud.refresh();
      navigate(`/admin/crm/invoices/${data.item._id}`);
    } catch (err) {
      setConvertError(err.response?.data?.message || "Could not raise the invoice");
    }
  };

  const columns = [
    {
      key: "number",
      header: "Quotation",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.number}</p>
          <p className="text-xs text-slate-400">{row.title || day(row.issuedOn)}</p>
        </div>
      ),
    },
    {
      key: "to",
      header: "For",
      render: (row) =>
        row.client?.name || row.lead?.name || <span className="text-slate-400">—</span>,
    },
    {
      key: "total",
      header: "Amount",
      className: "text-right",
      render: (row) => <span className="tabular-nums text-slate-900">{rupees(row.total)}</span>,
    },
    { key: "validUntil", header: "Valid till", render: (row) => day(row.validUntil) },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {!row.invoice && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConverting(row);
                setConvertError("");
              }}
              title="Raise an invoice from this"
              className="rounded-md p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-700"
            >
              <FileOutput size={15} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              open(row);
            }}
            title={row.invoice ? "View" : "Edit"}
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

  const locked = Boolean(editing?.invoice);

  return (
    <div>
      <PageHeader title="Quotations" subtitle="What was offered, and whether they said yes">
        <Button variant="outline" onClick={() => setRateCardOpen(true)}>
          <Settings2 size={15} />
          Rate card
        </Button>
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          New quotation
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by number or title"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: QUOTATION_STATUS },
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
          onRowClick={open}
          emptyTitle="No quotations yet"
          emptyMessage="Quote a lead or a client — accepted ones become invoices in one click."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? `Quotation ${editing.number}` : "New quotation"}
        subtitle={
          locked
            ? "This quotation has been invoiced and is now a record"
            : "Goes to a client, or to a lead who is not one yet"
        }
        size="lg"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {locked ? "Close" : "Cancel"}
            </Button>
            {!locked && (
              <Button onClick={save} loading={saving} disabled={!form.client && !form.lead}>
                Save
              </Button>
            )}
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="Client">
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value, lead: "" }))}
              options={lookups.clientOptions}
              placeholder="An existing client"
              disabled={locked}
            />
          </Field>
          <Field label="…or a lead">
            <Select
              value={form.lead}
              onChange={(e) => setForm((f) => ({ ...f, lead: e.target.value, client: "" }))}
              options={leadOptions}
              placeholder="Somebody not yet a client"
              disabled={locked}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={QUOTATION_STATUS}
              disabled={locked}
            />
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. E-commerce website + 6 months SEO"
              disabled={locked}
            />
          </Field>
          <Field label="Valid until">
            <Input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
              disabled={locked}
            />
          </Field>
        </div>

        {locked ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm">
            <p className="font-medium text-slate-900">{rupees(editing.total)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {editing.lines?.length} line{editing.lines?.length === 1 ? "" : "s"} · already
              invoiced, so this can no longer be changed.
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

        {!locked && (
          <Field label="Notes" className="mt-4">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        )}
      </Modal>

      <Modal
        open={rateCardOpen}
        title="Rate card"
        subtitle="What the studio sells, and what it charges — used to fill quotation lines"
        size="lg"
        onClose={() => {
          setRateCardOpen(false);
          loadServices();
        }}
      >
        <RateCard />
      </Modal>

      <Modal
        open={Boolean(converting)}
        title="Raise an invoice?"
        subtitle={converting ? `${converting.number} — ${rupees(converting.total)}` : ""}
        size="sm"
        onClose={() => setConverting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConverting(null)}>
              Cancel
            </Button>
            <Button onClick={raiseInvoice}>Raise invoice</Button>
          </>
        }
      >
        <Alert>{convertError}</Alert>
        <p className="text-sm text-slate-600">
          The lines carry across exactly as quoted, so the client is billed what they accepted. The
          quotation is marked accepted and can no longer be edited.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this quotation?"
        message={`${target?.number} will be removed. Marking it rejected keeps the record — and how many quotes are won against sent is the only honest measure of whether the pricing is right.`}
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
