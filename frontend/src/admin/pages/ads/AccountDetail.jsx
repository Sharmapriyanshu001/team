import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileBarChart,
  FileOutput,
  Plus,
  Trash2,
  Upload,
  WalletMinimal,
} from "lucide-react";

import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  Select,
} from "../../../shared/components/ui";
import ImportDialog from "./ImportDialog";
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_STATUS,
  FUNDING_MODES,
  count,
  rupees,
} from "./constants";

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

const BLANK_CAMPAIGN = {
  name: "",
  objective: "leads",
  status: "active",
  dailyBudget: "",
  externalId: "",
  notes: "",
};

const BLANK_DAY = {
  date: "",
  spend: "",
  impressions: "",
  clicks: "",
  conversions: "",
  conversionValue: "",
};

function Stat({ label, value, sub, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    red: "text-red-600",
    amber: "text-amber-700",
    green: "text-green-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className={`text-xl font-semibold leading-none tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function AccountDetail() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [importing, setImporting] = useState(false);

  const [campaignForm, setCampaignForm] = useState(null);
  const [savingCampaign, setSavingCampaign] = useState(false);

  const [entering, setEntering] = useState(null);
  const [dayForm, setDayForm] = useState(BLANK_DAY);

  const [toppingUp, setToppingUp] = useState(false);
  const [topup, setTopup] = useState({ amount: "", mode: "bank_transfer", reference: "" });

  const [billing, setBilling] = useState(false);
  const [billForm, setBillForm] = useState({ from: "", to: "" });
  const [billError, setBillError] = useState("");

  const [doomed, setDoomed] = useState(null);

  const load = useCallback(() => {
    adminApi
      .get(`/admin/ads/accounts/${id}/detail`)
      .then(({ data: payload }) => {
        setData(payload);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this account"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const saveCampaign = async () => {
    setSavingCampaign(true);
    setError("");
    try {
      const payload = { ...campaignForm, dailyBudget: Number(campaignForm.dailyBudget) || 0 };
      if (campaignForm._id) {
        await adminApi.put(`/admin/ads/accounts/${id}/campaigns/${campaignForm._id}`, payload);
      } else {
        await adminApi.post(`/admin/ads/accounts/${id}/campaigns`, payload);
      }
      setCampaignForm(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save that campaign");
    } finally {
      setSavingCampaign(false);
    }
  };

  const saveDay = async () => {
    setError("");
    try {
      const { data: result } = await adminApi.post(
        `/admin/ads/accounts/${id}/campaigns/${entering._id}/days`,
        dayForm
      );
      setNotice(result.message);
      setEntering(null);
      setDayForm(BLANK_DAY);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that day");
      setEntering(null);
    }
  };

  const saveTopup = async () => {
    setError("");
    try {
      await adminApi.post(`/admin/ads/accounts/${id}/topups`, {
        ...topup,
        amount: Number(topup.amount),
      });
      setToppingUp(false);
      setTopup({ amount: "", mode: "bank_transfer", reference: "" });
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that top-up");
      setToppingUp(false);
    }
  };

  const runBilling = async () => {
    setBillError("");
    try {
      const { data: result } = await adminApi.post(`/admin/ads/accounts/${id}/bill`, billForm);
      setBilling(false);
      setNotice(result.message);
      load();
    } catch (err) {
      setBillError(err.response?.data?.message || "Could not raise that invoice");
    }
  };

  if (loading) return <Loader label="Loading account…" />;
  if (!data) return <Alert>{error || "Ad account not found"}</Alert>;

  const account = data.item;
  const pacing = data.pacing;
  const money = data.money;
  const totals = data.thisMonth;

  return (
    <div>
      <Link
        to="/admin/ads"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        All ad accounts
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{account.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {account.client?.name}
            {account.externalId && ` · ${account.externalId}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge value={account.platform} />
            <Badge value={account.status} />
            <span className="text-xs text-slate-500">
              {FUNDING_MODES.find((f) => f.value === account.funding)?.label}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {account.funding === "prepaid" && (
            <Button variant="outline" onClick={() => setToppingUp(true)}>
              <WalletMinimal size={15} />
              Add top-up
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const now = new Date();
              const first = new Date(now.getFullYear(), now.getMonth(), 1);
              setBillForm({
                from: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`,
                to: localToday(),
              });
              setBillError("");
              setBilling(true);
            }}
          >
            <FileOutput size={15} />
            Raise invoice
          </Button>
          <Link to={`/admin/ads/${id}/report`}>
            <Button variant="outline">
              <FileBarChart size={15} />
              Report
            </Button>
          </Link>
          <Button onClick={() => setImporting(true)}>
            <Upload size={15} />
            Import CSV
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Spent this month"
          value={rupees(totals.spend)}
          sub={pacing ? `of ${rupees(pacing.budget)} budget` : "no budget set"}
          tone={pacing && pacing.variance > 0 ? "red" : "slate"}
        />
        <Stat
          label="On pace for"
          value={pacing ? rupees(pacing.onPaceFor) : "—"}
          sub={
            pacing
              ? pacing.variance > 0
                ? `${rupees(pacing.variance)} over`
                : `${rupees(Math.abs(pacing.variance))} under`
              : ""
          }
          tone={pacing && pacing.variance > 0 ? "red" : "green"}
        />
        <Stat
          label="Results this month"
          value={count(totals.conversions)}
          sub={totals.cpa ? `${rupees(totals.cpa)} each` : ""}
        />
        {money.kind === "recoverable" ? (
          <Stat
            label="Fronted, not yet billed"
            value={rupees(money.unrecovered)}
            sub={money.recoveredTo ? `billed up to ${day(money.recoveredTo)}` : "nothing billed yet"}
            tone={money.unrecovered > 0 ? "amber" : "slate"}
          />
        ) : money.kind === "balance" ? (
          <Stat
            label="Client's balance"
            value={rupees(money.balance)}
            sub={`${rupees(money.toppedUp)} in, ${rupees(money.spentAllTime)} spent`}
            tone={money.exhausted ? "red" : "slate"}
          />
        ) : (
          <Stat label="Clicks this month" value={count(totals.clicks)} sub={totals.cpc ? `${rupees(totals.cpc)} each` : ""} />
        )}
      </div>

      <Card>
        <CardHeader
          title="Campaigns"
          subtitle="Click a spend figure to enter or correct a day"
          action={
            <Button size="sm" variant="outline" onClick={() => setCampaignForm(BLANK_CAMPAIGN)}>
              <Plus size={14} />
              Add campaign
            </Button>
          }
        />

        {data.campaigns.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            No campaigns yet. Import a CSV and they will be created from it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Campaign</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Spend</th>
                  <th className="px-4 py-2.5 text-right">Clicks</th>
                  <th className="px-4 py-2.5 text-right">Results</th>
                  <th className="px-4 py-2.5">Latest data</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign._id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setCampaignForm({ ...BLANK_CAMPAIGN, ...campaign })}
                        className="text-left font-medium text-slate-900 hover:text-blue-600"
                      >
                        {campaign.name}
                      </button>
                      <p className="text-xs text-slate-400">{campaign.objective}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge value={campaign.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          setEntering(campaign);
                          setDayForm({ ...BLANK_DAY, date: localToday() });
                        }}
                        className="rounded px-1 tabular-nums text-slate-900 hover:bg-blue-50"
                        title="Enter a day"
                      >
                        {rupees(campaign.totalSpend)}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {count(campaign.totalClicks)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {count(campaign.totalConversions)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {day(campaign.lastDataOn)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setDoomed(campaign)}
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {money.kind === "balance" && account.topups?.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Top-ups" subtitle={`${rupees(money.toppedUp)} received in total`} />
          <div className="divide-y divide-slate-100">
            {[...account.topups].reverse().map((entry) => (
              <div key={entry._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-[6rem] font-medium tabular-nums text-slate-900">
                  {rupees(entry.amount)}
                </span>
                <Badge value={entry.mode} />
                {entry.reference && (
                  <span className="font-mono text-xs text-slate-500">{entry.reference}</span>
                )}
                <span className="ml-auto text-xs text-slate-400">
                  {day(entry.receivedOn)}
                  {entry.recordedByName && ` · ${entry.recordedByName}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {money.kind === "recoverable" && account.recoveries?.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Already billed back" subtitle="Periods covered by an invoice" />
          <div className="divide-y divide-slate-100">
            {[...account.recoveries].reverse().map((entry) => (
              <div key={entry._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-[6rem] font-medium tabular-nums text-slate-900">
                  {rupees(entry.amount)}
                </span>
                <span className="text-xs text-slate-500">
                  {day(entry.from)} – {day(entry.to)}
                </span>
                {entry.invoiceNumber && (
                  <Link
                    to={`/admin/crm/invoices/${entry.invoice}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {entry.invoiceNumber}
                  </Link>
                )}
                <span className="ml-auto text-xs text-slate-400">{entry.recordedByName}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ImportDialog
        open={importing}
        accountId={id}
        onClose={() => setImporting(false)}
        onDone={load}
      />

      {/* -------------------------------------------------------- campaign */}
      <Modal
        open={Boolean(campaignForm)}
        title={campaignForm?._id ? campaignForm.name : "Add campaign"}
        size="sm"
        onClose={() => setCampaignForm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCampaignForm(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveCampaign}
              loading={savingCampaign}
              disabled={!campaignForm?.name?.trim()}
            >
              Save
            </Button>
          </>
        }
      >
        {campaignForm && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2" hint="Must match the name in the export">
              <Input
                value={campaignForm.name}
                onChange={(e) => setCampaignForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Objective">
              <Select
                value={campaignForm.objective}
                onChange={(e) => setCampaignForm((f) => ({ ...f, objective: e.target.value }))}
                options={CAMPAIGN_OBJECTIVES}
              />
            </Field>
            <Field label="Status">
              <Select
                value={campaignForm.status}
                onChange={(e) => setCampaignForm((f) => ({ ...f, status: e.target.value }))}
                options={CAMPAIGN_STATUS}
              />
            </Field>
            <Field label="Daily budget">
              <Input
                type="number"
                min="0"
                value={campaignForm.dailyBudget}
                onChange={(e) => setCampaignForm((f) => ({ ...f, dailyBudget: e.target.value }))}
              />
            </Field>
            <Field label="Campaign ID">
              <Input
                value={campaignForm.externalId}
                onChange={(e) => setCampaignForm((f) => ({ ...f, externalId: e.target.value }))}
                className="font-mono"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------- day */}
      <Modal
        open={Boolean(entering)}
        title={`A day on ${entering?.name || ""}`}
        subtitle="Entering a day that already exists replaces it — platform figures move for a day or two"
        size="sm"
        onClose={() => setEntering(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEntering(null)}>
              Cancel
            </Button>
            <Button onClick={saveDay} disabled={!dayForm.date || dayForm.spend === ""}>
              Record
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input
              type="date"
              value={dayForm.date}
              onChange={(e) => setDayForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <Field label="Spend" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={dayForm.spend}
              onChange={(e) => setDayForm((f) => ({ ...f, spend: e.target.value }))}
            />
          </Field>
          <Field label="Impressions">
            <Input
              type="number"
              min="0"
              value={dayForm.impressions}
              onChange={(e) => setDayForm((f) => ({ ...f, impressions: e.target.value }))}
            />
          </Field>
          <Field label="Clicks">
            <Input
              type="number"
              min="0"
              value={dayForm.clicks}
              onChange={(e) => setDayForm((f) => ({ ...f, clicks: e.target.value }))}
            />
          </Field>
          <Field label="Results">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={dayForm.conversions}
              onChange={(e) => setDayForm((f) => ({ ...f, conversions: e.target.value }))}
            />
          </Field>
          <Field label="Value of those results">
            <Input
              type="number"
              min="0"
              value={dayForm.conversionValue}
              onChange={(e) => setDayForm((f) => ({ ...f, conversionValue: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- top-up */}
      <Modal
        open={toppingUp}
        title="Record a top-up"
        subtitle="Money the client has sent for ads"
        size="sm"
        onClose={() => setToppingUp(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setToppingUp(false)}>
              Cancel
            </Button>
            <Button onClick={saveTopup} disabled={!topup.amount}>
              Record
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
              value={topup.amount}
              onChange={(e) => setTopup((t) => ({ ...t, amount: e.target.value }))}
            />
          </Field>
          <Field label="How">
            <Select
              value={topup.mode}
              onChange={(e) => setTopup((t) => ({ ...t, mode: e.target.value }))}
              options={[
                { value: "upi", label: "UPI" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "cash", label: "Cash" },
                { value: "cheque", label: "Cheque" },
              ]}
            />
          </Field>
          <Field label="Reference" className="sm:col-span-2">
            <Input
              value={topup.reference}
              onChange={(e) => setTopup((t) => ({ ...t, reference: e.target.value }))}
              placeholder="UTR or cheque number"
            />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------------------------------------- bill */}
      <Modal
        open={billing}
        title="Raise an invoice"
        subtitle={
          account.funding === "studio_card"
            ? "The spend you fronted for this period, plus your fee"
            : "Your management fee for this period"
        }
        size="sm"
        onClose={() => setBilling(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBilling(false)}>
              Cancel
            </Button>
            <Button onClick={runBilling} disabled={!billForm.from || !billForm.to}>
              Raise as draft
            </Button>
          </>
        }
      >
        <Alert>{billError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" required>
            <Input
              type="date"
              value={billForm.from}
              onChange={(e) => setBillForm((f) => ({ ...f, from: e.target.value }))}
            />
          </Field>
          <Field label="To" required>
            <Input
              type="date"
              value={billForm.to}
              onChange={(e) => setBillForm((f) => ({ ...f, to: e.target.value }))}
            />
          </Field>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {account.funding === "studio_card"
            ? "Ad spend goes on with no GST — it is a reimbursement, not a supply. The fee carries 18%. Both can be changed on the invoice while it is still a draft."
            : "The spend itself is never invoiced here — the client paid the platform directly."}
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(doomed)}
        title="Delete this campaign?"
        message={`"${doomed?.name}" and every day of spend recorded against it will be removed. If it has been billed back already, the invoice stays but the numbers behind it will not.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await adminApi.delete(`/admin/ads/accounts/${id}/campaigns/${doomed._id}`);
          setDoomed(null);
          load();
        }}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
