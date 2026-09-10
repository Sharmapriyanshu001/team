import { useEffect, useState } from "react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import { Alert, Card, CardHeader, Loader, PageHeader, ProgressBar, Select } from "../../shared/components/ui";
import { money, prettify } from "../constants";

/**
 * The four questions a sales review actually asks, on one page.
 *
 * Where does the work come from, who is closing it, why are we losing, and
 * what has been paid. They arrive in one response so the page is not four
 * spinners, and every number is counted from the records rather than stored,
 * so none of it can drift from the rows it summarises.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Reports() {
  const { isSalesHead } = useSalesAccess();
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setData(null);
    salesApi
      .get("/sales/reports", { params: { year, month } })
      .then(({ data: d }) => active && setData(d))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load reports"));
    return () => {
      active = false;
    };
  }, [year, month]);

  if (error) return <Alert>{error}</Alert>;

  const maxSource = Math.max(1, ...(data?.sources || []).map((s) => s.total));
  const maxMonthly = Math.max(1, ...(data?.monthly || []).map((m) => m.created));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales reports"
        subtitle={isSalesHead ? "The whole floor" : "Your own numbers"}
      >
        <div className="flex gap-2">
          <Select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="w-36"
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
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
        </div>
      </PageHeader>

      {!data ? (
        <Loader label="Counting…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Quotations raised", value: data.money.quotationsRaised },
              { label: "Billed", value: money(data.money.billed) },
              { label: "Received", value: money(data.money.received) },
              { label: "Outstanding", value: money(data.money.outstanding) },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{s.value}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* ------------------------------------------------ where from */}
            <Card>
              <CardHeader
                title="Where the work comes from"
                subtitle="And which sources actually convert"
              />
              <div className="space-y-3 p-4 pt-0">
                {data.sources
                  .filter((s) => s.total > 0)
                  .map((s) => (
                    <div key={s.source}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">{prettify(s.source)}</span>
                        <span className="text-slate-500">
                          {s.total} leads · {s.conversionRate}% won
                        </span>
                      </div>
                      <ProgressBar value={(s.total / maxSource) * 100} />
                    </div>
                  ))}
                {data.sources.every((s) => !s.total) && (
                  <p className="text-sm text-slate-500">No leads yet.</p>
                )}
              </div>
            </Card>

            {/* --------------------------------------------------- why lost */}
            <Card>
              <CardHeader
                title="Why deals were lost"
                subtitle="The whole reason for asking"
              />
              <div className="divide-y divide-slate-100">
                {data.lostReasons.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">Nothing lost yet.</p>
                )}
                {data.lostReasons.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between p-3 text-sm">
                    <span className="capitalize text-slate-800">{r.reason}</span>
                    <span className="text-slate-500">
                      {r.count} · {money(r.value)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------- performance */}
          <Card>
            <CardHeader
              title={isSalesHead ? "Who is closing" : "Your performance"}
              subtitle="Counted from the deals, not from a stored figure"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Person</th>
                    <th className="px-4 py-2">Leads</th>
                    <th className="px-4 py-2">Won</th>
                    <th className="px-4 py-2">Lost</th>
                    <th className="px-4 py-2">Conversion</th>
                    <th className="px-4 py-2">Open value</th>
                    <th className="px-4 py-2">Won value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.team.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-slate-500">
                        Nothing to show yet.
                      </td>
                    </tr>
                  )}
                  {data.team.map((t) => (
                    <tr key={t.user}>
                      <td className="px-4 py-2 font-medium text-slate-900">{t.user}</td>
                      <td className="px-4 py-2 text-slate-600">{t.leads}</td>
                      <td className="px-4 py-2 text-green-700">{t.won}</td>
                      <td className="px-4 py-2 text-red-600">{t.lost}</td>
                      <td className="px-4 py-2 text-slate-700">{t.conversionRate}%</td>
                      <td className="px-4 py-2 text-slate-600">{money(t.openValue)}</td>
                      <td className="px-4 py-2 font-medium text-slate-900">{money(t.wonValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ------------------------------------------------------- trend */}
          <Card>
            <CardHeader title="The last twelve months" subtitle="Leads created, and how many closed" />
            <div className="flex items-end gap-1 overflow-x-auto p-4 pt-0">
              {data.monthly.map((m) => (
                <div key={m.month} className="flex w-12 shrink-0 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-slate-300"
                      style={{ height: `${(m.created / maxMonthly) * 100}%` }}
                      title={`${m.created} created`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-green-500"
                      style={{ height: `${(m.won / maxMonthly) * 100}%` }}
                      title={`${m.won} won`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400">{m.month.slice(5)}</span>
                </div>
              ))}
              {data.monthly.length === 0 && (
                <p className="text-sm text-slate-500">Not enough history yet.</p>
              )}
            </div>
            <p className="px-4 pb-3 text-[11px] text-slate-400">
              Grey is leads created, green is deals won.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
