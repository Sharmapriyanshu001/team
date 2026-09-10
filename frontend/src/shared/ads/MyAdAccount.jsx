import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import Modal from "../components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
} from "../components/ui";

const rupees = (value) =>
  value === null || value === undefined ? "—" : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;

const count = (value) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN");

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

const BLANK_DAY = {
  date: "",
  spend: "",
  impressions: "",
  clicks: "",
  conversions: "",
  conversionValue: "",
};

/**
 * One ad account, as the person running it sees it.
 *
 * They enter the day's numbers and watch the pacing — which is the whole job.
 * Everything about the money between the studio and the client is absent, and
 * the server does not send it, so there is nothing here to leak.
 */
export default function MyAdAccount({ api, base, homePath }) {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [entering, setEntering] = useState(null);
  const [form, setForm] = useState(BLANK_DAY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get(`${base}/ads/accounts/${id}`)
      .then(({ data: payload }) => {
        setData(payload);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this account"))
      .finally(() => setLoading(false));
  }, [api, base, id]);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data: result } = await api.post(`${base}/ads/campaigns/${entering._id}/days`, form);
      setNotice(result.message);
      setEntering(null);
      setForm(BLANK_DAY);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that day");
      setEntering(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading account…" />;
  if (!data) return <Alert>{error || "Ad account not found"}</Alert>;

  const account = data.item;
  const pacing = data.pacing;
  const totals = data.thisMonth;

  return (
    <div>
      <Link
        to={homePath}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        My ad accounts
      </Link>

      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">{account.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {account.client?.name}
          {account.externalId && ` · ${account.externalId}`}
        </p>
        <div className="mt-2 flex gap-2">
          <Badge value={account.platform} />
          <Badge value={account.status} />
        </div>
      </div>

      <Alert>{error}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Spent this month", rupees(totals.spend), pacing ? `of ${rupees(pacing.budget)}` : "no budget set"],
          ["On pace for", pacing ? rupees(pacing.onPaceFor) : "—", pacing && pacing.variance > 0 ? `${rupees(pacing.variance)} over` : ""],
          ["Results", count(totals.conversions), totals.cpa ? `${rupees(totals.cpa)} each` : ""],
          ["Clicks", count(totals.clicks), totals.cpc ? `${rupees(totals.cpc)} each` : ""],
        ].map(([label, value, sub], index) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p
              className={`text-xl font-semibold leading-none tabular-nums ${
                index === 1 && pacing && pacing.variance > 0 ? "text-red-600" : "text-slate-900"
              }`}
            >
              {value}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">{label}</p>
            {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
          </div>
        ))}
      </div>

      {pacing && pacing.variance > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <p className="px-4 py-3 text-sm text-amber-900">
            At this rate the month finishes at {rupees(pacing.onPaceFor)} — {rupees(pacing.variance)}{" "}
            over the {rupees(pacing.budget)} budget. Worth telling somebody today rather than on the
            30th.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader title="Campaigns" subtitle="Click a spend figure to enter today's numbers" />

        {data.campaigns.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            No campaigns on this account yet.
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
                  <th className="px-4 py-2.5">Latest</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign._id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{campaign.name}</p>
                      <p className="text-xs text-slate-400">{campaign.objective}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge value={campaign.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          setEntering(campaign);
                          setForm({ ...BLANK_DAY, date: localToday() });
                        }}
                        className="rounded px-1 tabular-nums text-slate-900 hover:bg-blue-50"
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(entering)}
        title={`A day on ${entering?.name || ""}`}
        subtitle="Entering a day that already exists replaces it"
        size="sm"
        onClose={() => setEntering(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEntering(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.date || form.spend === ""}>
              Record
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <Field label="Spend" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.spend}
              onChange={(e) => setForm((f) => ({ ...f, spend: e.target.value }))}
            />
          </Field>
          <Field label="Impressions">
            <Input
              type="number"
              min="0"
              value={form.impressions}
              onChange={(e) => setForm((f) => ({ ...f, impressions: e.target.value }))}
            />
          </Field>
          <Field label="Clicks">
            <Input
              type="number"
              min="0"
              value={form.clicks}
              onChange={(e) => setForm((f) => ({ ...f, clicks: e.target.value }))}
            />
          </Field>
          <Field label="Results">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.conversions}
              onChange={(e) => setForm((f) => ({ ...f, conversions: e.target.value }))}
            />
          </Field>
          <Field label="Value of those results">
            <Input
              type="number"
              min="0"
              value={form.conversionValue}
              onChange={(e) => setForm((f) => ({ ...f, conversionValue: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
