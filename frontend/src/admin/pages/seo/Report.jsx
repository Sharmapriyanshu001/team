import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, Minus, Printer } from "lucide-react";

import adminApi from "../../adminApi";
import { CHART } from "../../../shared/theme";
import { Alert, Button, Card, CardHeader, Field, Input, Loader } from "../../../shared/components/ui";

/**
 * The monthly report — the thing the retainer actually buys.
 *
 * Deliberately tables and stat tiles rather than charts. What a client asks
 * about a ranking report is "which of my terms moved, and to where", and that
 * is a question about named rows: a line chart of forty keywords is unreadable
 * and a chart of three is a table with extra steps.
 *
 * The one exception is the position spread, which is a magnitude — how much of
 * the list sits in each band — and reads faster as one bar than as five
 * numbers. It is a single hue, light to dark, from the panel's own palette:
 * darker means a better position, so the bar visibly fills from the left as
 * the work lands.
 */

const day = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * Where the list sits, in bands. One hue from the shared palette, light to
 * dark, plus a neutral for terms that are nowhere — which is an absence, not a
 * worse shade of the same thing.
 */
const BANDS = [
  { label: "1–3", color: CHART.blueDark, test: (p) => p !== null && p <= 3 },
  { label: "4–10", color: CHART.blue, test: (p) => p !== null && p > 3 && p <= 10 },
  { label: "11–20", color: CHART.blueMid, test: (p) => p !== null && p > 10 && p <= 20 },
  { label: "21–50", color: CHART.blueLight, test: (p) => p !== null && p > 20 && p <= 50 },
  { label: "51–100", color: CHART.bluePale, test: (p) => p !== null && p > 50 },
  { label: "Not ranking", color: CHART.greyLight, test: (p) => p === null },
];

function Spread({ rows }) {
  const counts = BANDS.map((band) => ({
    ...band,
    count: rows.filter((row) => band.test(row.currentPosition ?? null)).length,
  }));
  const total = rows.length || 1;

  return (
    <div>
      {/* 2px surface gaps between segments, per the mark spec */}
      <div className="flex h-3 gap-[2px] overflow-hidden">
        {counts.map((band) =>
          band.count ? (
            <div
              key={band.label}
              title={`${band.label}: ${band.count}`}
              style={{
                width: `${(band.count / total) * 100}%`,
                background: band.color,
              }}
              className="first:rounded-l last:rounded-r"
            />
          ) : null
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {counts.map((band) => (
          <span key={band.label} className="inline-flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              style={{ background: band.color }}
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
            />
            <span className="text-slate-600">{band.label}</span>
            <span className="font-medium tabular-nums text-slate-900">{band.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Movement, always with an arrow beside the colour so it never reads on hue alone. */
function Move({ change }) {
  if (change === null || change === undefined)
    return <span className="text-xs text-slate-400">new</span>;
  if (change === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <Minus size={12} /> 0
      </span>
    );

  const up = change > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        up ? "text-green-700" : "text-red-600"
      }`}
    >
      {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(change)}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-2xl font-semibold leading-none tabular-nums text-slate-900">{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

const firstOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return isoDay(d);
};

export default function Report() {
  const { id } = useParams();

  const [range, setRange] = useState({ from: firstOfMonth(), to: isoDay(new Date()) });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /**
   * Loading is switched on by the control that changes the range, not in the
   * effect — the same shape the panel's list hook uses, so the effect never
   * sets state on its way in.
   */
  const changeRange = useCallback((patch) => {
    setLoading(true);
    setRange((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/seo/projects/${id}/report`, { params: range })
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

  const { engagement, keywords, backlinks, social, audit } = report;
  const s = keywords.summary;

  return (
    <div>
      <div className="print:hidden">
        <Link
          to={`/admin/seo/${id}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} />
          Back to engagement
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{engagement.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {engagement.client?.name}
            {engagement.website && ` · ${engagement.website.replace(/^https?:\/\//, "")}`}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {day(report.period.from)} to {day(report.period.to)}
          </p>
        </div>

        {/* Filters in one row above the content */}
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
        <Tile label="Keywords tracked" value={s.tracked} sub={`${s.ranking} ranking somewhere`} />
        <Tile label="In the top 10" value={s.topTen} sub={`${s.topThree} in the top 3`} />
        <Tile label="Improved this period" value={s.improved} sub={`${s.newlyRanking} newly ranking`} />
        <Tile label="Slipped" value={s.declined} sub={`${s.unchanged} unchanged`} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Where the list sits" subtitle="Every tracked keyword, by position band" />
        <div className="px-4 pb-4 pt-1">
          <Spread rows={keywords.rows} />
        </div>
      </Card>

      {(keywords.gained.length > 0 || keywords.lost.length > 0) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Biggest gains" />
            {keywords.gained.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing moved up.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {keywords.gained.map((row) => (
                  <div key={row._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="flex-1 truncate text-slate-700">{row.term}</span>
                    <span className="text-xs tabular-nums text-slate-400">
                      {row.startPosition ?? "—"} → {row.currentPosition}
                    </span>
                    <Move change={row.change} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Biggest drops" />
            {keywords.lost.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing slipped.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {keywords.lost.map((row) => (
                  <div key={row._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="flex-1 truncate text-slate-700">{row.term}</span>
                    <span className="text-xs tabular-nums text-slate-400">
                      {row.startPosition ?? "—"} → {row.currentPosition}
                    </span>
                    <Move change={row.change} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader title="Every keyword" subtitle="Start of period against where it sits now" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Keyword</th>
                <th className="px-4 py-2.5">Location</th>
                <th className="px-4 py-2.5 text-right">Was</th>
                <th className="px-4 py-2.5 text-right">Now</th>
                <th className="px-4 py-2.5 text-right">Change</th>
                <th className="px-4 py-2.5 text-right">Best ever</th>
              </tr>
            </thead>
            <tbody>
              {keywords.rows.map((row) => (
                <tr key={row._id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.term}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{row.location}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                    {row.startPosition ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">
                    {row.currentPosition ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Move change={row.change} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                    {row.best ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Backlinks" />
          <div className="grid grid-cols-3 gap-px bg-slate-100">
            {[
              ["Gained", backlinks.gained],
              ["Lost", backlinks.lost],
              ["Live now", backlinks.live],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-3 py-3 text-center">
                <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Social" subtitle={`${social.postsPublished} posts published`} />
          {social.followers.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No accounts linked.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {social.followers.map((row) => (
                <div key={row._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 truncate text-slate-700">
                    {row.handle}
                    <span className="ml-1 text-xs text-slate-400">{row.platform}</span>
                  </span>
                  <span className="tabular-nums text-slate-900">
                    {row.current?.toLocaleString("en-IN") ?? "—"}
                  </span>
                  {row.gained !== null && row.gained !== undefined && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                        row.gained >= 0 ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {row.gained >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                      {Math.abs(row.gained).toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Site health" subtitle={audit ? `Audited ${day(audit.ranOn)}` : "No audit yet"} />
          {!audit ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Run an audit to fill this in.</p>
          ) : (
            <div className="space-y-2 px-4 py-3">
              {[
                ["SEO", audit.scores.seo, audit.previousScores?.seo],
                ["Performance", audit.scores.performance, audit.previousScores?.performance],
                ["Accessibility", audit.scores.accessibility, audit.previousScores?.accessibility],
                ["Best practices", audit.scores.bestPractices, audit.previousScores?.bestPractices],
              ]
                .filter(([, score]) => score !== null && score !== undefined)
                .map(([label, score, before]) => (
                  <div key={label} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-slate-600">{label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        style={{ width: `${score}%`, background: CHART.blue }}
                        className="h-full rounded-full"
                      />
                    </div>
                    <span className="w-8 text-right tabular-nums font-medium text-slate-900">
                      {score}
                    </span>
                    {before !== null && before !== undefined && before !== score && (
                      <Move change={score - before} />
                    )}
                  </div>
                ))}
              <p className="pt-1 text-xs text-slate-400">
                {audit.openIssues} findings open · {audit.fixedIssues} fixed
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
