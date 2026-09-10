import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, Wallet } from "lucide-react";

import Modal, { ConfirmDialog } from "../components/Modal";
import { Alert, Badge, Button, Field, Input, Loader, Select } from "../components/ui";
import { prettify } from "../format";

/**
 * Wages, counted off the attendance sheet.
 *
 * The three numbers somebody actually asks for: what this month has earned so
 * far, what has been handed over, and what is still owed. All of it falls out
 * of one thing — a daily rate times the days that were marked — so the working
 * is shown rather than a total to be trusted.
 *
 * NOTHING HERE IS BANKED
 *
 * Earnings are computed by the server every time this loads. Correcting an
 * attendance mark from absent to present adds a day's pay immediately, with
 * nobody having to remember to recalculate anything. Only the rate and the
 * individual payments are written down. See backend/utils/salary.js.
 */

const money = (n = 0) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    : "—";

const STATUS_TONE = {
  present: "green",
  half_day: "amber",
  leave: "blue",
  absent: "red",
};

const BLANK_PAYMENT = { amount: "", paidOn: "", mode: "bank_transfer", reference: "", note: "" };

export default function SalaryTab({ api, basePath, employeeId, canEdit = true }) {
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [editingRate, setEditingRate] = useState(false);
  const [rate, setRate] = useState("");

  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState(BLANK_PAYMENT);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!employeeId) return undefined;

    let active = true;
    setData(null);

    api
      .get(`${basePath}/staff/${employeeId}/salary`, { params: { year, month } })
      .then(({ data: d }) => {
        if (!active) return;
        setData(d);
        setRate(String(d.dailyRate || ""));
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load salary"))
      .finally(() => {});

    return () => {
      active = false;
    };
  }, [api, basePath, employeeId, year, month, reloadKey]);

  const saveRate = async () => {
    setBusy(true);
    try {
      const { data: d } = await api.put(`${basePath}/staff/${employeeId}/salary/rate`, {
        dailyRate: Number(rate) || 0,
      });
      setNotice(d.message || "Rate saved");
      setEditingRate(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the rate");
    } finally {
      setBusy(false);
    }
  };

  const pay = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await api.post(`${basePath}/staff/${employeeId}/salary/payments`, {
        ...form,
        amount: Number(form.amount),
        paidOn: form.paidOn || undefined,
      });
      setNotice("Payment recorded — they have been told");
      setPaying(false);
      setForm(BLANK_PAYMENT);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not record that");
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async () => {
    setBusy(true);
    try {
      await api.delete(`${basePath}/staff/${employeeId}/salary/payments/${removing._id}`);
      setNotice("Payment removed");
      setRemoving(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not remove that");
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loader label="Adding up the month…" />;

  const m = data.month;

  return (
    <div className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}

      {/* ------------------------------------------------------ the rate */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Daily rate</p>
          {editingRate ? (
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-32"
                autoFocus
              />
              <Button size="sm" loading={busy} onClick={saveRate}>
                <Check size={13} /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingRate(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="mt-0.5 text-lg font-semibold text-slate-900">
              {data.rateSet ? `${money(data.dailyRate)} a day` : "Not set yet"}
            </p>
          )}
        </div>

        {canEdit && !editingRate && (
          <Button variant="outline" size="sm" onClick={() => setEditingRate(true)}>
            <Pencil size={13} /> {data.rateSet ? "Change" : "Set the rate"}
          </Button>
        )}
      </div>

      {/**
       * Without a rate every figure below is zero, which reads as "this person
       * has earned nothing" rather than "nobody has said what they are paid".
       * Said plainly instead of showing a page of zeros.
       */}
      {!data.rateSet ? (
        <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-4 py-6 text-center text-sm text-amber-800">
          Set a daily rate and this fills in on its own from the attendance sheet — every day
          marked present adds a day's pay.
        </p>
      ) : (
        <>
          {/* --------------------------------------------- which month */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-36"
              options={MONTHS.map((name, i) => ({ value: i + 1, label: name }))}
            />
            <Select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28"
              options={[0, 1, 2].map((n) => ({
                value: now.getFullYear() - n,
                label: String(now.getFullYear() - n),
              }))}
            />
            {canEdit && (
              <Button
                className="ml-auto"
                size="sm"
                onClick={() => {
                  setForm({ ...BLANK_PAYMENT, amount: m.due > 0 ? String(m.due) : "" });
                  setFormError("");
                  setPaying(true);
                }}
              >
                <Plus size={14} /> Record a payment
              </Button>
            )}
          </div>

          {/* ------------------------------------------- this month */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Earned in {MONTHS[m.month - 1]}</p>
              <p className="mt-0.5 text-xl font-semibold text-slate-900">{money(m.earned)}</p>
              <p className="text-[11px] text-slate-400">
                {m.payableDays} payable day{m.payableDays === 1 ? "" : "s"} of {m.marked} marked
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Paid this month</p>
              <p className="mt-0.5 text-xl font-semibold text-emerald-700">{money(m.paid)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Still owed this month</p>
              <p
                className={`mt-0.5 text-xl font-semibold ${
                  m.due > 0 ? "text-amber-700" : "text-slate-400"
                }`}
              >
                {money(Math.max(0, m.due))}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500">Paid all time</p>
              <p className="mt-0.5 text-xl font-semibold text-slate-900">
                {money(data.lifetime.paid)}
              </p>
              <p className="text-[11px] text-slate-400">
                of {money(data.lifetime.earned)} earned
              </p>
            </div>
          </div>

          {/**
           * The overall position, which is not the same as this month's.
           * Negative means they were paid ahead — an advance — and it is shown
           * as that rather than hidden behind a zero.
           */}
          <div
            className={`rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${
              data.lifetime.due > 0
                ? "bg-amber-50/60 text-amber-800 ring-amber-100"
                : data.lifetime.due < 0
                  ? "bg-blue-50/60 text-blue-800 ring-blue-100"
                  : "bg-emerald-50/60 text-emerald-800 ring-emerald-100"
            }`}
          >
            {data.lifetime.due > 0
              ? `${money(data.lifetime.due)} still owed overall, across ${data.lifetime.payableDays} payable days.`
              : data.lifetime.due < 0
                ? `Paid ${money(Math.abs(data.lifetime.due))} ahead — an advance against days not yet worked.`
                : "Fully settled — everything earned has been paid."}
          </div>

          {/* -------------------------------------- the day by day sheet */}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">
              {MONTHS[m.month - 1]}, day by day
            </p>
            {m.days.length ? (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50/95">
                    <tr className="border-b border-slate-200">
                      {["Date", "Marked", "Counts as", "Pay"].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.days.map((d) => (
                      <tr key={d.date} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-slate-700">{shortDate(d.date)}</td>
                        <td className="px-3 py-1.5">
                          <Badge value={prettify(d.status)} tone={STATUS_TONE[d.status]} />
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          {d.value === 1
                            ? "A full day"
                            : d.value === 0.5
                              ? "Half a day"
                              : d.status === "leave"
                                ? "Unpaid leave"
                                : "Nothing"}
                        </td>
                        <td
                          className={`px-3 py-1.5 font-medium ${
                            d.amount ? "text-slate-900" : "text-slate-300"
                          }`}
                        >
                          {d.amount ? money(d.amount) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                No attendance marked for {MONTHS[m.month - 1]} yet — nothing to count.
              </p>
            )}
          </div>

          {/* ------------------------------------------------ payments */}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Payments</p>
            {data.payments?.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.payments.map((p) => (
                  <div key={p._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {money(p.amount)}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {prettify(p.mode)}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {shortDate(p.paidOn)}
                        {p.recordedByName ? ` · recorded by ${p.recordedByName}` : ""}
                        {p.note ? ` · ${p.note}` : ""}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => setRemoving(p)}
                        title="Remove this entry"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                Nothing paid yet.
              </p>
            )}
          </div>
        </>
      )}

      {/* -------------------------------------------------- record a payment */}

      <Modal
        open={paying}
        title="Record a salary payment"
        subtitle="A note that money has already been sent — this app does not move it"
        onClose={() => setPaying(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={busy || !Number(form.amount)}>
              {busy ? "Saving…" : "Record it"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={pay}>
          {formError && <Alert>{formError}</Alert>}

          <Field label="Amount" required hint={m?.due > 0 ? `${money(m.due)} owed this month` : ""}>
            <Input
              type="number"
              min={1}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid on" hint="Blank means today">
              <Input
                type="date"
                value={form.paidOn}
                onChange={(e) => setForm({ ...form, paidOn: e.target.value })}
              />
            </Field>
            <Field label="How">
              <Select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                options={["bank_transfer", "upi", "cash", "cheque", "other"].map((v) => ({
                  value: v,
                  label: prettify(v),
                }))}
              />
            </Field>
          </div>

          <Field label="Reference" hint="A UTR or cheque number — what makes it findable later">
            <Input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>

          <Field label="Note">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Wallet size={13} className="mt-0.5 shrink-0" />
            They are notified as soon as you save this.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        loading={busy}
        onClose={() => setRemoving(null)}
        onConfirm={removePayment}
        title="Remove this payment entry?"
        confirmLabel="Remove it"
        message={`The record of ${money(
          removing?.amount
        )} comes off their history and the amount goes back to owed. They are told, because a payment that quietly disappears is worse than one never entered.`}
      />
    </div>
  );
}
