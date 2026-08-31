import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "../../../shared/components/ui";
import { rupees } from "./billing";
import { BILLING_UNITS } from "./constants";

const BLANK = {
  name: "",
  description: "",
  category: "",
  rate: "",
  unit: "fixed",
  hsnSac: "",
  taxPercent: 18,
  active: true,
};

/**
 * The rate card, edited in place.
 *
 * Rendered inside a modal on the quotations screen rather than given a page of
 * its own: it is a list somebody opens while writing a quote and closes again,
 * not a place they go.
 */
export default function RateCard() {
  const crud = useCrud("crm/services", { limit: 100 });

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);

  const open = (row) => {
    setError("");
    setEditing(row || BLANK);
    setForm(row ? { ...BLANK, ...row, rate: row.rate ?? "" } : BLANK);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        rate: Number(form.rate) || 0,
        taxPercent: Number(form.taxPercent) || 0,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this service");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Alert>{crud.error || error}</Alert>

      {editing ? (
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Service" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Business website (5 pages)"
              />
            </Field>
            <Field label="Category">
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Web / App / SEO"
              />
            </Field>
            <Field label="Rate">
              <Input
                type="number"
                min="0"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
              />
            </Field>
            <Field label="Per">
              <Select
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                options={BILLING_UNITS}
              />
            </Field>
            <Field label="GST %">
              <Input
                type="number"
                min="0"
                max="100"
                value={form.taxPercent}
                onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
              />
            </Field>
            <Field label="HSN / SAC" hint="A property of the service, not of one invoice">
              <Input
                value={form.hsnSac}
                onChange={(e) => setForm((f) => ({ ...f, hsnSac: e.target.value }))}
                placeholder="998314"
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open(null)}>
          <Plus size={14} />
          Add a service
        </Button>
      )}

      <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {crud.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            Nothing on the rate card yet.
          </p>
        ) : (
          crud.rows.map((row) => (
            <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-[12rem] flex-1">
                <p className="font-medium text-slate-900">{row.name}</p>
                <p className="text-xs text-slate-400">
                  {row.category || "uncategorised"}
                  {row.hsnSac && ` · ${row.hsnSac}`}
                </p>
              </div>

              <span className="tabular-nums text-slate-900">{rupees(row.rate)}</span>
              <span className="text-xs text-slate-400">
                / {BILLING_UNITS.find((u) => u.value === row.unit)?.label.replace("Per ", "") || row.unit}
              </span>
              <Badge value={`${row.taxPercent}% GST`} />

              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => open(row)}
                  className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setTarget(row)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={Boolean(target)}
        title="Remove from the rate card?"
        message={`"${target?.name}" will be removed. Quotations and invoices that used it keep their own copy of the description and rate, so nothing already sent changes.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await crud.remove(target._id);
          setTarget(null);
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
