import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, HandCoins, Plus, Trash2, Users } from "lucide-react";

import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import { CHART } from "../../../shared/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  MultiSelect,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  PROPERTY_KINDS,
  PROPERTY_STATUS,
  REVENUE_SOURCES,
  labelOf,
  money,
  signedMoney,
} from "./constants";

const localDate = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const firstOfMonth = () => {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—";

const BLANK_ENTRY = {
  kind: "revenue",
  category: "admob",
  amount: "",
  currency: "INR",
  fxRate: "",
  on: "",
  settledOn: "",
  reference: "",
  note: "",
};

/**
 * Profit month by month.
 *
 * The one chart here, and it earns its place: whether an app is worth keeping
 * is a question about a trend, and a trend is a shape. Profit above the line
 * and loss below, so a run of red months is visible at a glance rather than
 * needing twelve numbers to be compared.
 */
function History({ series }) {
  if (!series?.length) return null;

  const peak = Math.max(...series.map((m) => Math.abs(m.profit)), 1);

  return (
    <div>
      <div className="flex h-32 items-center gap-1">
        {series.map((month) => {
          const height = (Math.abs(month.profit) / peak) * 50;
          const up = month.profit >= 0;

          return (
            <div
              key={month.month}
              title={`${month.month}: ${signedMoney(month.profit)}`}
              className="flex h-full flex-1 flex-col justify-center"
            >
              <div className="flex h-1/2 items-end">
                {up && (
                  <div
                    style={{ height: `${height * 2}%`, background: CHART.blue }}
                    className="w-full rounded-t-[3px]"
                  />
                )}
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex h-1/2 items-start">
                {!up && (
                  <div
                    style={{ height: `${height * 2}%`, background: "#DC2626" }}
                    className="w-full rounded-b-[3px]"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>{series[0]?.month}</span>
        <span>Profit above the line, loss below</span>
        <span>{series[series.length - 1]?.month}</span>
      </div>
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();

  const [range, setRange] = useState({ from: firstOfMonth(), to: localDate(new Date()) });
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [adOptions, setAdOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [entry, setEntry] = useState(null);
  const [savingEntry, setSavingEntry] = useState(false);

  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [paying, setPaying] = useState(null);
  const [payment, setPayment] = useState({ amount: "", reference: "", on: "" });

  const [doomed, setDoomed] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const changeRange = useCallback((patch) => {
    setLoading(true);
    setRange((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/portfolio/properties/${id}/detail`, { params: range })
      .then(({ data: payload }) => {
        if (!active) return;
        setData(payload);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load this property");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [id, range, reloadKey]);

  useEffect(() => {
    adminApi
      .get(`/admin/portfolio/properties/${id}/history`, { params: { months: 12 } })
      .then(({ data: payload }) => setHistory(payload.series || []))
      .catch(() => setHistory([]));
  }, [id, reloadKey]);

  useEffect(() => {
    adminApi
      .get("/admin/ads/accounts", { params: { limit: 200 } })
      .then(({ data: payload }) =>
        setAdOptions(
          (payload.items || []).map((row) => ({
            value: row._id,
            label: `${row.name} (${row.platform})`,
          }))
        )
      )
      .catch(() => setAdOptions([]));
  }, []);

  const refresh = () => setReloadKey((key) => key + 1);

  const saveEntry = async () => {
    setSavingEntry(true);
    setError("");
    try {
      await adminApi.post(`/admin/portfolio/properties/${id}/entries`, {
        ...entry,
        amount: Number(entry.amount),
        fxRate: entry.fxRate === "" ? undefined : Number(entry.fxRate),
        settledOn: entry.settledOn || null,
      });
      setEntry(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that");
      setEntry(null);
    } finally {
      setSavingEntry(false);
    }
  };

  const markReceived = async (row) => {
    setError("");
    try {
      await adminApi.put(`/admin/portfolio/properties/${id}/entries/${row._id}`, {
        settledOn: localDate(new Date()),
      });
      setNotice("Marked as received");
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update that");
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setError("");
    try {
      await adminApi.put(`/admin/portfolio/properties/${id}`, settings);
      setSettings(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save");
    } finally {
      setSavingSettings(false);
    }
  };

  const pay = async () => {
    setError("");
    try {
      await adminApi.post(
        `/admin/portfolio/properties/${id}/partners/${paying._id}/pay`,
        { ...payment, amount: Number(payment.amount) }
      );
      setPaying(null);
      setPayment({ amount: "", reference: "", on: "" });
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that payment");
      setPaying(null);
    }
  };

  if (loading && !data) return <Loader label="Loading…" />;
  if (!data) return <Alert>{error || "Property not found"}</Alert>;

  const property = data.item;
  const pnl = data.pnl;

  const openEntry = (kind) =>
    setEntry({
      ...BLANK_ENTRY,
      kind,
      category: kind === "revenue" ? "admob" : "hosting",
      currency: property.baseCurrency || "INR",
      on: localDate(new Date()),
    });

  return (
    <div>
      <Link
        to="/admin/portfolio"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Portfolio
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{property.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{property.handle || "—"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge value={property.kind} />
            <Badge value={property.status} />
            {property.publishedApp && (
              <Link
                to={`/admin/play/apps/${property.publishedApp._id}`}
                className="text-xs text-blue-600 hover:underline"
              >
                on Play →
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="From">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => changeRange({ from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={range.to}
              onChange={(e) => changeRange({ to: e.target.value })}
            />
          </Field>
          <Button
            variant="outline"
            onClick={() =>
              setSettings({
                name: property.name,
                kind: property.kind,
                status: property.status,
                handle: property.handle || "",
                url: property.url || "",
                notes: property.notes || "",
                adAccounts: (property.adAccounts || []).map((a) => a._id || a),
                partners: (property.partners || []).map((p) => ({ ...p })),
              })
            }
          >
            <Users size={15} />
            Setup
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xl font-semibold leading-none tabular-nums text-slate-900">
            {money(pnl.revenue.earned)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Earned</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {money(pnl.revenue.received)} received
            {pnl.revenue.pending > 0 && (
              <span className="text-amber-600"> · {money(pnl.revenue.pending)} to come</span>
            )}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xl font-semibold leading-none tabular-nums text-slate-900">
            {money(pnl.expenses.total)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Spent</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {money(pnl.expenses.linkedAdSpend)} on ads · {money(pnl.expenses.entered)} other
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p
            className={`text-xl font-semibold leading-none tabular-nums ${
              pnl.profit >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {signedMoney(pnl.profit)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Profit</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {pnl.margin === null ? "—" : `${pnl.margin}% margin`}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xl font-semibold leading-none tabular-nums text-slate-900">
            {signedMoney(pnl.studio.take)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Our share</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{pnl.studio.sharePercent}% of it is ours</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {history.length > 1 && (
            <Card>
              <CardHeader title="Twelve months" subtitle="One bad month is a bad month; six is an answer" />
              <div className="px-4 pb-4 pt-2">
                <History series={history} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="The books"
              subtitle="Newest first"
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEntry("expense")}>
                    <Plus size={14} />
                    Cost
                  </Button>
                  <Button size="sm" onClick={() => openEntry("revenue")}>
                    <Plus size={14} />
                    Income
                  </Button>
                </div>
              }
            />

            {data.entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Nothing recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.entries.map((row) => (
                  <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-[10rem] flex-1">
                      <p className="font-medium text-slate-900">
                        {row.kind === "payout"
                          ? `Paid ${row.partnerName}`
                          : labelOf(
                              row.kind === "revenue" ? REVENUE_SOURCES : EXPENSE_CATEGORIES,
                              row.category
                            )}
                      </p>
                      <p className="text-xs text-slate-400">
                        {day(row.on)}
                        {row.currency !== "INR" && ` · ${row.amount} ${row.currency} @ ${row.fxRate}`}
                        {row.reference && ` · ${row.reference}`}
                      </p>
                    </div>

                    <span
                      className={`tabular-nums font-medium ${
                        row.kind === "revenue"
                          ? "text-green-700"
                          : row.kind === "payout"
                            ? "text-slate-500"
                            : "text-slate-900"
                      }`}
                    >
                      {row.kind === "revenue" ? "+" : "−"}
                      {money(row.baseAmount)}
                    </span>

                    {row.kind === "revenue" &&
                      (row.settledOn ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                          <Check size={12} />
                          received
                        </span>
                      ) : (
                        <button
                          onClick={() => markReceived(row)}
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
                        >
                          mark received
                        </button>
                      ))}

                    <button
                      onClick={() => setDoomed(row)}
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Partners"
              subtitle={
                pnl.partners.length
                  ? `We keep ${pnl.studio.sharePercent}%`
                  : "Nobody else owns a share"
              }
            />

            {pnl.partners.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                Add partners from Setup if you run this with somebody.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {pnl.partners.map((partner) => (
                  <div key={partner._id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{partner.name}</p>
                        <p className="text-xs text-slate-400">
                          {partner.sharePercent}% of {partner.shareOf}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPaying(partner);
                          setPayment({
                            amount: Math.max(0, partner.owed),
                            reference: "",
                            on: localDate(new Date()),
                          });
                        }}
                      >
                        <HandCoins size={13} />
                        Pay
                      </Button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <p className="tabular-nums font-medium text-slate-900">
                          {money(partner.share)}
                        </p>
                        <p className="text-[11px] text-slate-400">their share</p>
                      </div>
                      <div>
                        <p className="tabular-nums text-slate-600">{money(partner.paid)}</p>
                        <p className="text-[11px] text-slate-400">paid so far</p>
                      </div>
                      <div>
                        <p
                          className={`tabular-nums font-medium ${
                            partner.owed > 0 ? "text-amber-700" : "text-slate-400"
                          }`}
                        >
                          {signedMoney(partner.owed)}
                        </p>
                        <p className="text-[11px] text-slate-400">still owed</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {property.adAccounts?.length > 0 && (
            <Card>
              <CardHeader title="Ad accounts" subtitle="Their spend counts as a cost here" />
              <div className="divide-y divide-slate-100">
                {property.adAccounts.map((account) => (
                  <Link
                    key={account._id}
                    to={`/admin/ads/${account._id}`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
                  >
                    <span className="text-slate-900">{account.name}</span>
                    <Badge value={account.platform} />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- entry */}
      <Modal
        open={Boolean(entry)}
        title={entry?.kind === "revenue" ? "Money in" : "Money out"}
        subtitle={
          entry?.kind === "revenue"
            ? "AdMob reports a month now and pays it weeks later — record it now, mark it received when it lands"
            : "Ad spend on a linked account is counted automatically — do not enter it here as well"
        }
        size="sm"
        onClose={() => setEntry(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEntry(null)}>
              Cancel
            </Button>
            <Button onClick={saveEntry} loading={savingEntry} disabled={!entry?.amount || !entry?.on}>
              Record
            </Button>
          </>
        }
      >
        {entry && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What kind" className="sm:col-span-2">
              <Select
                value={entry.category}
                onChange={(e) => setEntry((f) => ({ ...f, category: e.target.value }))}
                options={entry.kind === "revenue" ? REVENUE_SOURCES : EXPENSE_CATEGORIES}
              />
            </Field>

            <Field label="Amount" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={entry.amount}
                onChange={(e) => setEntry((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>

            <Field label="Currency">
              <Select
                value={entry.currency}
                onChange={(e) => setEntry((f) => ({ ...f, currency: e.target.value }))}
                options={CURRENCIES}
              />
            </Field>

            {entry.currency !== (property.baseCurrency || "INR") && (
              <Field
                label={`One ${entry.currency} in ₹`}
                required
                className="sm:col-span-2"
                hint="The rate you were actually paid at — it is kept with this row, not re-valued later"
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={entry.fxRate}
                  onChange={(e) => setEntry((f) => ({ ...f, fxRate: e.target.value }))}
                  placeholder="88.50"
                />
              </Field>
            )}

            <Field label="Which month or day" required>
              <Input
                type="date"
                value={entry.on}
                onChange={(e) => setEntry((f) => ({ ...f, on: e.target.value }))}
              />
            </Field>

            <Field
              label={entry.kind === "revenue" ? "Received on" : "Paid on"}
              hint="Leave blank if it has not moved yet"
            >
              <Input
                type="date"
                value={entry.settledOn}
                onChange={(e) => setEntry((f) => ({ ...f, settledOn: e.target.value }))}
              />
            </Field>

            <Field label="Reference" className="sm:col-span-2">
              <Input
                value={entry.reference}
                onChange={(e) => setEntry((f) => ({ ...f, reference: e.target.value }))}
                placeholder="Payment id, invoice number"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ----------------------------------------------------------- payment */}
      <Modal
        open={Boolean(paying)}
        title={`Pay ${paying?.name || ""}`}
        subtitle={paying ? `${money(paying.owed)} owed` : ""}
        size="sm"
        onClose={() => setPaying(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={!payment.amount}>
              Record payment
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" required>
            <Input
              type="number"
              min="1"
              autoFocus
              value={payment.amount}
              onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label="Paid on">
            <Input
              type="date"
              value={payment.on}
              onChange={(e) => setPayment((p) => ({ ...p, on: e.target.value }))}
            />
          </Field>
          <Field label="Reference" className="sm:col-span-2">
            <Input
              value={payment.reference}
              onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
              placeholder="UTR"
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          A payout divides profit — it is not a cost of the business, so it does not change the
          profit figure.
        </p>
      </Modal>

      {/* ------------------------------------------------------------ setup */}
      <Modal
        open={Boolean(settings)}
        title="Setup"
        subtitle="Partners, ad accounts and the basics"
        onClose={() => setSettings(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettings(null)}>
              Cancel
            </Button>
            <Button onClick={saveSettings} loading={savingSettings}>
              Save
            </Button>
          </>
        }
      >
        {settings && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input
                  value={settings.name}
                  onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                />
              </Field>
              <Field label="What is it">
                <Select
                  value={settings.kind}
                  onChange={(e) => setSettings((s) => ({ ...s, kind: e.target.value }))}
                  options={PROPERTY_KINDS}
                />
              </Field>
              <Field label="Package name or domain">
                <Input
                  value={settings.handle}
                  onChange={(e) => setSettings((s) => ({ ...s, handle: e.target.value }))}
                  className="font-mono"
                />
              </Field>
              <Field label="Status">
                <Select
                  value={settings.status}
                  onChange={(e) => setSettings((s) => ({ ...s, status: e.target.value }))}
                  options={PROPERTY_STATUS}
                />
              </Field>
              <Field
                label="Ad accounts that promote this"
                className="sm:col-span-2"
                hint="Their spend is counted as a cost here, so it never has to be typed twice"
              >
                <MultiSelect
                  options={adOptions}
                  value={settings.adAccounts}
                  onChange={(value) => setSettings((s) => ({ ...s, adAccounts: value }))}
                  placeholder="Search ad accounts…"
                  emptyLabel="No ad accounts on record"
                />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Partners
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      partners: [
                        ...s.partners,
                        { name: "", sharePercent: 0, sharesCosts: true, active: true },
                      ],
                    }))
                  }
                >
                  <Plus size={13} />
                  Add
                </Button>
              </div>

              {settings.partners.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                  Nobody else owns a share of this.
                </p>
              ) : (
                <div className="space-y-2">
                  {settings.partners.map((partner, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-3">
                      <div className="grid gap-3 sm:grid-cols-4">
                        <Field label="Name" className="sm:col-span-2">
                          <Input
                            value={partner.name}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                partners: s.partners.map((p, i) =>
                                  i === index ? { ...p, name: e.target.value } : p
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Share %">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={partner.sharePercent}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                partners: s.partners.map((p, i) =>
                                  i === index
                                    ? { ...p, sharePercent: Number(e.target.value) }
                                    : p
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Of what">
                          <Select
                            value={partner.sharesCosts ? "profit" : "revenue"}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                partners: s.partners.map((p, i) =>
                                  i === index
                                    ? { ...p, sharesCosts: e.target.value === "profit" }
                                    : p
                                ),
                              }))
                            }
                            options={[
                              { value: "profit", label: "Profit" },
                              { value: "revenue", label: "Revenue" },
                            ]}
                          />
                        </Field>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-[11px] text-slate-400">
                          {partner.sharesCosts
                            ? "Takes a cut after costs — shares the risk"
                            : "Takes a cut off the top — costs are ours"}
                        </p>
                        <button
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              partners: s.partners.filter((_, i) => i !== index),
                            }))
                          }
                          className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}

                  <p className="text-right text-xs text-slate-500">
                    Partners hold{" "}
                    {settings.partners.reduce((sum, p) => sum + (Number(p.sharePercent) || 0), 0)}%
                    — we keep the rest
                  </p>
                </div>
              )}
            </div>

            <Field label="Notes">
              <Textarea
                rows={2}
                value={settings.notes}
                onChange={(e) => setSettings((s) => ({ ...s, notes: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(doomed)}
        title="Delete this line?"
        message={`${money(doomed?.baseAmount)} will be removed from the books, and every figure on this page will change to match.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await adminApi.delete(`/admin/portfolio/properties/${id}/entries/${doomed._id}`);
          setDoomed(null);
          refresh();
        }}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
