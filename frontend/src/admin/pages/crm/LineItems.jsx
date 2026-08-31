import { Plus, Trash2 } from "lucide-react";

import { Button, Input, Select } from "../../../shared/components/ui";
import { BLANK_LINE, money, previewTotals } from "./billing";

/**
 * The lines of a quotation or an invoice, plus a running total.
 *
 * The total shown here is a preview, computed the same way the server does but
 * never trusted: what gets stored is whatever the server calculates from the
 * lines that were posted. Two implementations of tax arithmetic is one too
 * many, so this one is only ever allowed to be wrong on screen for a moment.
 */

export default function LineItems({ lines, onChange, discount, onDiscount, services = [], interState = false }) {
  const set = (index, patch) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const add = () => onChange([...lines, { ...BLANK_LINE }]);
  const drop = (index) => onChange(lines.filter((_, i) => i !== index));

  /** Picking from the rate card fills the row rather than linking to it. */
  const pickService = (index, serviceId) => {
    const service = services.find((s) => s._id === serviceId);
    if (!service) return set(index, { service: "" });

    return set(index, {
      service: service._id,
      description: service.name,
      hsnSac: service.hsnSac || "",
      rate: service.rate,
      unit: service.unit,
      taxPercent: service.taxPercent,
    });
  };

  const totals = previewTotals(lines, discount, interState);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Description</th>
              <th className="w-24 px-3 py-2">HSN/SAC</th>
              <th className="w-20 px-3 py-2 text-right">Qty</th>
              <th className="w-28 px-3 py-2 text-right">Rate</th>
              <th className="w-20 px-3 py-2 text-right">GST %</th>
              <th className="w-28 px-3 py-2 text-right">Amount</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-100 last:border-0 align-top">
                <td className="px-3 py-2">
                  {services.length > 0 && (
                    <Select
                      value={line.service || ""}
                      onChange={(e) => pickService(index, e.target.value)}
                      options={services.map((s) => ({
                        value: s._id,
                        label: `${s.name} — ₹${s.rate}`,
                      }))}
                      placeholder="From the rate card…"
                      className="mb-1.5"
                    />
                  )}
                  <Input
                    value={line.description}
                    onChange={(e) => set(index, { description: e.target.value })}
                    placeholder="What is being billed"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={line.hsnSac}
                    onChange={(e) => set(index, { hsnSac: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => set(index, { quantity: e.target.value })}
                    className="text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    value={line.rate}
                    onChange={(e) => set(index, { rate: e.target.value })}
                    className="text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={line.taxPercent}
                    onChange={(e) => set(index, { taxPercent: e.target.value })}
                    className="text-right"
                  />
                </td>
                <td className="px-3 py-2 pt-4 text-right tabular-nums text-slate-700">
                  {money(totals.rows[index]?.amount)}
                </td>
                <td className="px-3 py-2 pt-4 text-right">
                  {lines.length > 1 && (
                    <button
                      onClick={() => drop(index)}
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <Button size="sm" variant="outline" onClick={add}>
          <Plus size={14} />
          Add line
        </Button>

        <div className="min-w-[16rem] space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(totals.subtotal)}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">Discount</span>
            <Input
              type="number"
              min="0"
              value={discount}
              onChange={(e) => onDiscount(e.target.value)}
              className="w-28 text-right"
            />
          </div>

          <div className="flex justify-between text-slate-600">
            <span>Taxable</span>
            <span className="tabular-nums">{money(totals.taxable)}</span>
          </div>

          {interState ? (
            <div className="flex justify-between text-slate-600">
              <span>IGST</span>
              <span className="tabular-nums">{money(totals.igst)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-slate-600">
                <span>CGST</span>
                <span className="tabular-nums">{money(totals.cgst)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>SGST</span>
                <span className="tabular-nums">{money(totals.sgst)}</span>
              </div>
            </>
          )}

          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">{money(totals.total)}</span>
          </div>

          <p className="text-right text-[11px] text-slate-400">
            The server recalculates this on save
          </p>
        </div>
      </div>
    </div>
  );
}
