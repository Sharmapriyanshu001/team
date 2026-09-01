import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Minus, Printer } from "lucide-react";

import adminApi from "../../adminApi";
import { CHART } from "../../../shared/theme";
import { Alert, Button, Card, CardHeader, Field, Input, Loader } from "../../../shared/components/ui";
import { count, rupees } from "./constants";

/**
 * What a client is shown for a period.
 *
 * Tables and tiles, with one bar chart. The chart earns its place because
 * spend over a month is a shape — a flat line, a weekend dip, the day somebody
 * doubled a budget — and that shape is the thing a table of thirty numbers
 * cannot show. Everything else here is named rows, which belong in a table.
 *
 * One hue, light to dark by magnitude, from the panel's own palette.
 */

const day = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

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

const pct = (now, before) => {
  if (before === null || before === undefined || !before) return null;
  return Math.round(((now - before) / before) * 100);
};

/**
 * Change against the period before, always with an arrow so it never reads on
 * colour alone. `betterWhenLower` flips which direction is good — a falling
 * cost per result is a win, a falling number of results is not.
 */
function Change({ now, before, betterWhenLower = false }) {
  const change = pct(now, before);
  if (change === null) return <span className="text-[11px] text-slate-400">no prior data</span>;
  if (change === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
        <Minus size={10} /> flat
      </span>
    );

  const up = change > 0;
  const good = betterWhenLower ? !up : up;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
        good ? "text-green-700" : "text-red-600"
      }`}
    >
      {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
      {Math.abs(change)}%
    </span>
  );
}

function Tile({ label, value, sub, now, before, betterWhenLower }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xl font-semibold leading-none tabular-nums text-slate-900">{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        {sub}
        {now !== undefined && (
          <Change now={now} before={before} betterWhenLower={betterWhenLower} />
        )}
      </p>
    </div>
  );
}

/** Spend by day. One hue; the tallest bar is the darkest step. */
function SpendChart({ daily }) {
  if (daily.length < 2) return null;

  const peak = Math.max(...daily.map((d) => d.spend)) || 1;

  const shade = (value) => {
    const share = value / peak;
    if (share > 0.8) return CHART.blueDark;
    if (share > 0.6) return CHART.blue;
    if (share > 0.4) return CHART.blueMid;
    if (share > 0.2) return CHART.blueLight;
    return CHART.bluePale;
  };

  return (
    <div>
      <div className="flex h-28 items-end gap-[2px]">
        {daily.map((entry) => (
          <div
            key={entry.date}
            title={`${entry.date}: ${rupees(entry.spend)}`}
            style={{
              height: `${Math.max(2, (entry.spend / peak) * 100)}%`,
              background: shade(entry.spend),
            }}
            className="min-w-[3px] flex-1 rounded-t-[3px]"
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>{daily[0]?.date}</span>
        <span>Peak {rupees(peak)}</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function Report() {
  const { id } = useParams();

  const [range, setRange] = useState({ from: firstOfMonth(), to: localDate(new Date()) });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const changeRange = useCallback((patch) => {
    setLoading(true);
    setRange((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/ads/accounts/${id}/report`, { params: range })
      .then(({ data }) => {
        if (!active) return;
        setReport(data);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not build this report");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [id, range]);

  if (loading && !report) return <Loader label="Building report…" />;
  if (!report) return <Alert>{error || "Nothing to report"}</Alert>;

  const { account, totals, previous, campaigns, daily, pacing, fee } = report;

  return (
    <div>
      <div className="print:hidden">
        <Link
          to={`/admin/ads/${id}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} />
          Back to account
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{account.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {account.client?.name} · {account.platform}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {day(report.period.from)} to {day(report.period.to)}
          </p>
        </div>

        <div className="flex items-end gap-2 print:hidden">
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
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={15} />
            Print
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Spent"
          value={rupees(totals.spend)}
          sub="vs last period"
          now={totals.spend}
          before={previous.spend}
        />
        <Tile
          label="Results"
          value={count(totals.conversions)}
          sub="vs last period"
          now={totals.conversions}
          before={previous.conversions}
        />
        <Tile
          label="Cost per result"
          value={totals.cpa === null ? "—" : rupees(totals.cpa)}
          sub="lower is better"
          now={totals.cpa}
          before={previous.cpa}
          betterWhenLower
        />
        <Tile
          label="Return on spend"
          value={totals.roas === null ? "—" : `${totals.roas}×`}
          sub="vs last period"
          now={totals.roas}
          before={previous.roas}
        />
      </div>

      {pacing && (
        <Card className="mb-4">
          <CardHeader title="Against the budget" />
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="tabular-nums font-medium text-slate-900">
                {rupees(pacing.spent)}
              </span>
              <span className="text-xs text-slate-400">of {rupees(pacing.budget)} this month</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                style={{
                  width: `${Math.min(100, pacing.usedPercent)}%`,
                  background: pacing.variance > 0 ? "#DC2626" : CHART.blue,
                }}
                className="h-full rounded-full"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {pacing.usedPercent}% used by day {pacing.dayOfMonth} of {pacing.daysInMonth} — on
              pace for {rupees(pacing.onPaceFor)}
              {pacing.variance > 0 ? (
                <span className="font-medium text-red-600"> ({rupees(pacing.variance)} over)</span>
              ) : (
                <span className="text-slate-400">
                  {" "}
                  ({rupees(Math.abs(pacing.variance))} under)
                </span>
              )}
            </p>
          </div>
        </Card>
      )}

      {daily.length > 1 && (
        <Card className="mb-4">
          <CardHeader title="Spend by day" subtitle="Where the money actually went" />
          <div className="px-4 pb-4 pt-2">
            <SpendChart daily={daily} />
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader title="By campaign" subtitle="Biggest spend first" />
        {campaigns.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            Nothing spent in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Campaign</th>
                  <th className="px-4 py-2.5 text-right">Spend</th>
                  <th className="px-4 py-2.5 text-right">Impressions</th>
                  <th className="px-4 py-2.5 text-right">Clicks</th>
                  <th className="px-4 py-2.5 text-right">CTR</th>
                  <th className="px-4 py-2.5 text-right">CPC</th>
                  <th className="px-4 py-2.5 text-right">Results</th>
                  <th className="px-4 py-2.5 text-right">Cost/result</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={row._id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="text-xs text-slate-400">{row.objective}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                      {rupees(row.spend)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {count(row.impressions)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {count(row.clicks)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {row.ctr === null ? "—" : `${row.ctr}%`}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {row.cpc === null ? "—" : rupees(row.cpc)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {count(row.conversions)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                      {row.cpa === null ? "—" : rupees(row.cpa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Impressions", count(totals.impressions), totals.impressions, previous.impressions, false],
          ["Clicks", count(totals.clicks), totals.clicks, previous.clicks, false],
          [
            "Cost per click",
            totals.cpc === null ? "—" : rupees(totals.cpc),
            totals.cpc,
            previous.cpc,
            true,
          ],
        ].map(([label, value, now, before, lower]) => (
          <Tile
            key={label}
            label={label}
            value={value}
            sub="vs last period"
            now={now}
            before={before}
            betterWhenLower={lower}
          />
        ))}
      </div>

      {fee > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Management fee for this period: {rupees(fee)}. Raise it as an invoice from the account
          screen.
        </p>
      )}
    </div>
  );
}
