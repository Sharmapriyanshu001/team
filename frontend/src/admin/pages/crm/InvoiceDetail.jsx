import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer, Trash2 } from "lucide-react";

import adminApi from "../../adminApi";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card, CardHeader, Loader } from "../../../shared/components/ui";
import { money, rupees } from "./billing";

/**
 * One invoice, as the client would see it.
 *
 * Printable rather than a generated PDF: the browser's own print already
 * produces a PDF, gets the page size right, and needs no library that has to
 * be kept in step with the layout. `print:` utilities hide the panel's own
 * furniture so what comes out is the document and nothing else.
 */

const day = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

export default function InvoiceDetail() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [doomed, setDoomed] = useState(null);

  const load = useCallback(() => {
    adminApi
      .get(`/admin/crm/invoices/${id}/detail`)
      .then(({ data: payload }) => {
        setData(payload);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this invoice"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const removePayment = async () => {
    try {
      await adminApi.delete(`/admin/crm/invoices/${id}/payments/${doomed._id}`);
      setDoomed(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not remove that payment");
      setDoomed(null);
    }
  };

  if (loading) return <Loader label="Loading invoice…" />;
  if (!data) return <Alert>{error || "Invoice not found"}</Alert>;

  const invoice = data.item;
  const company = data.company || {};

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to="/admin/crm/invoices"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} />
          All invoices
        </Link>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer size={15} />
          Print / save as PDF
        </Button>
      </div>

      <Alert>{error}</Alert>

      <Card className="print:border-0 print:shadow-none">
        <div className="p-6 sm:p-8">
          {/* -------------------------------------------------------- header */}
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {company.companyName || "Tax Invoice"}
              </h1>
              {company.address && (
                <p className="mt-1 max-w-xs whitespace-pre-line text-xs text-slate-500">
                  {company.address}
                </p>
              )}
              <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                {company.gstNumber && <p>GSTIN: {company.gstNumber}</p>}
                {company.companyEmail && <p>{company.companyEmail}</p>}
                {company.companyPhone && <p>{company.companyPhone}</p>}
              </div>
            </div>

            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Tax Invoice</p>
              <p className="text-xl font-semibold tabular-nums text-slate-900">{invoice.number}</p>
              <p className="mt-1 text-xs text-slate-500">Issued {day(invoice.issuedOn)}</p>
              {invoice.dueOn && <p className="text-xs text-slate-500">Due {day(invoice.dueOn)}</p>}
              <div className="mt-2 flex justify-end print:hidden">
                <Badge value={invoice.status} />
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------ billed to */}
          <div className="flex flex-wrap justify-between gap-6 py-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Billed to</p>
              <p className="mt-1.5 font-medium text-slate-900">
                {invoice.billedTo?.company || invoice.billedTo?.name}
              </p>
              {invoice.billedTo?.company && invoice.billedTo?.name && (
                <p className="text-sm text-slate-600">{invoice.billedTo.name}</p>
              )}
              {invoice.billedTo?.address && (
                <p className="mt-1 max-w-xs whitespace-pre-line text-xs text-slate-500">
                  {invoice.billedTo.address}
                </p>
              )}
              <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                {invoice.billedTo?.gstNumber && <p>GSTIN: {invoice.billedTo.gstNumber}</p>}
                {invoice.billedTo?.email && <p>{invoice.billedTo.email}</p>}
              </div>
            </div>

            {invoice.title && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-400">For</p>
                <p className="mt-1.5 text-sm text-slate-700">{invoice.title}</p>
                {invoice.periodLabel && (
                  <p className="text-xs text-slate-500">{invoice.periodLabel}</p>
                )}
              </div>
            )}
          </div>

          {/* ---------------------------------------------------------- lines */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-3">Description</th>
                  <th className="w-24 px-3 py-2.5">HSN/SAC</th>
                  <th className="w-16 px-3 py-2.5 text-right">Qty</th>
                  <th className="w-28 px-3 py-2.5 text-right">Rate</th>
                  <th className="w-16 px-3 py-2.5 text-right">GST</th>
                  <th className="w-32 py-2.5 pl-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line._id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-3 text-slate-900">{line.description}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{line.hsnSac || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {line.quantity}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {money(line.rate)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {line.taxPercent}%
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums text-slate-900">
                      {money(line.amount ?? line.quantity * line.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --------------------------------------------------------- totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(invoice.subtotal)}</span>
              </div>

              {invoice.discount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Discount</span>
                  <span className="tabular-nums">− {money(invoice.discount)}</span>
                </div>
              )}

              <div className="flex justify-between text-slate-600">
                <span>Taxable value</span>
                <span className="tabular-nums">{money(invoice.taxableValue)}</span>
              </div>

              {invoice.interState ? (
                <div className="flex justify-between text-slate-600">
                  <span>IGST</span>
                  <span className="tabular-nums">{money(invoice.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST</span>
                    <span className="tabular-nums">{money(invoice.cgst)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST</span>
                    <span className="tabular-nums">{money(invoice.sgst)}</span>
                  </div>
                </>
              )}

              {invoice.roundOff !== 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Round off</span>
                  <span className="tabular-nums">{money(invoice.roundOff)}</span>
                </div>
              )}

              <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-semibold text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{rupees(invoice.total)}</span>
              </div>

              {invoice.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-green-700">
                    <span>Paid</span>
                    <span className="tabular-nums">− {rupees(invoice.amountPaid)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900">
                    <span>Balance due</span>
                    <span className="tabular-nums">{rupees(invoice.balance)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------- footer */}
          {(company.payToDetails || invoice.terms || invoice.notes) && (
            <div className="mt-8 space-y-3 border-t border-slate-200 pt-5 text-xs text-slate-500">
              {company.payToDetails && (
                <div>
                  <p className="font-medium text-slate-700">Payment details</p>
                  <p className="mt-0.5 whitespace-pre-line">{company.payToDetails}</p>
                </div>
              )}
              {invoice.terms && (
                <div>
                  <p className="font-medium text-slate-700">Terms</p>
                  <p className="mt-0.5 whitespace-pre-line">{invoice.terms}</p>
                </div>
              )}
              {invoice.notes && <p className="whitespace-pre-line">{invoice.notes}</p>}
            </div>
          )}
        </div>
      </Card>

      {invoice.payments?.length > 0 && (
        <Card className="mt-4 print:hidden">
          <CardHeader
            title="Payments received"
            subtitle={`${rupees(invoice.amountPaid)} of ${rupees(invoice.total)}`}
          />
          <div className="divide-y divide-slate-100">
            {invoice.payments.map((payment) => (
              <div key={payment._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-[6rem] font-medium tabular-nums text-slate-900">
                  {rupees(payment.amount)}
                </span>
                <Badge value={payment.mode} />
                {payment.reference && (
                  <span className="font-mono text-xs text-slate-500">{payment.reference}</span>
                )}
                <span className="ml-auto text-xs text-slate-400">
                  {day(payment.receivedOn)}
                  {payment.recordedByName && ` · ${payment.recordedByName}`}
                </span>
                <button
                  onClick={() => setDoomed(payment)}
                  title="Remove this payment"
                  className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(doomed)}
        title="Remove this payment?"
        message={`${doomed ? rupees(doomed.amount) : ""} will be taken off this invoice, and its status will go back to what it was before. Only do this if the payment was recorded by mistake.`}
        confirmLabel="Remove"
        onConfirm={removePayment}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
