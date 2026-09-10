import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, Trophy } from "lucide-react";

import employeeApi from "../employeeApi";
import { Alert, Badge, Card, CardHeader, Loader, PageHeader, ProgressBar, Select } from "../../shared/components/ui";

/**
 * What this month is worth, and why.
 *
 * The whole design of this page is "show the working". A score somebody cannot
 * check is a score they will not trust, so every task that moved the number is
 * listed with the reason it did — including the ones that cost points. Hiding
 * those would leave a total nobody could explain, which is worse than the bad
 * news itself.
 *
 * There is nothing to press. The score answers to the task list, and the
 * adjustments are HR's; an employee seeing their own number in full is the
 * point, not editing it.
 */

const money = (n = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const OUTCOME = {
  completed: { tone: "green", icon: CheckCircle2 },
  overdue: { tone: "red", icon: Clock },
  open: { tone: "slate", icon: CalendarClock },
};

export default function Incentive() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  const period = `${year}-${String(month).padStart(2, "0")}`;

  useEffect(() => {
    let active = true;
    setData(null);
    employeeApi
      .get("/employee/incentive", { params: { period } })
      .then(({ data: d }) => active && setData(d))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your points"));
    return () => {
      active = false;
    };
  }, [period]);

  useEffect(() => {
    let active = true;
    employeeApi
      .get("/employee/incentive/history", { params: { months: 6 } })
      .then(({ data: d }) => active && setHistory(d.items || []))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Alert>{error}</Alert>;

  const maxHistory = Math.max(1, ...history.map((h) => h.total));

  return (
    <div className="space-y-4">
      <PageHeader title="My incentive" subtitle="Points earned against your deadlines, and what they are worth">
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
            options={[0, 1].map((n) => ({
              value: now.getFullYear() - n,
              label: String(now.getFullYear() - n),
            }))}
          />
        </div>
      </PageHeader>

      {!data ? (
        <Loader label="Working out your month…" />
      ) : (
        <>
          {/* ------------------------------------------------- the headline */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <Trophy size={14} /> Points this month
                </p>
                <p className="mt-1 text-4xl font-semibold text-slate-900">{data.total}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.taskPoints} from tasks
                  {data.adjustmentPoints !== 0 && (
                    <>
                      {" "}
                      · {data.adjustmentPoints > 0 ? "+" : ""}
                      {data.adjustmentPoints} from HR
                    </>
                  )}
                </p>
                {data.floored && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Tasks and adjustments came to {data.raw}. A month never goes below zero, so
                    this shows 0.
                  </p>
                )}
              </div>

              <div className="text-right">
                <p className="text-xs text-slate-500">Bonus at this score</p>
                <p className="mt-1 text-3xl font-semibold text-green-700">
                  {money(data.bonus.amount)}
                </p>
                {data.bonus.label && (
                  <p className="text-xs text-slate-500">{data.bonus.label}</p>
                )}
              </div>
            </div>

            {/* The distance to the next step is the part people act on */}
            {data.bonus.next && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    <strong>{data.bonus.next.pointsAway}</strong> more points for{" "}
                    {money(data.bonus.next.amount)}
                    {data.bonus.next.label ? ` · ${data.bonus.next.label}` : ""}
                  </span>
                  <span className="text-slate-500">
                    {data.total} / {data.bonus.next.minPoints}
                  </span>
                </div>
                <ProgressBar value={(data.total / data.bonus.next.minPoints) * 100} />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "On time", value: data.counts.completedOnTime, tone: "text-green-700" },
              { label: "Late", value: data.counts.completedLate, tone: "text-amber-700" },
              {
                // Finished, but no deadline was ever agreed, so it is not
                // counted as punctual. Shown so the work still appears
                // somewhere rather than quietly leaving the tally.
                label: "No due date",
                value: data.counts.completedNoDate ?? 0,
                tone: "text-slate-500",
              },
              { label: "Overdue", value: data.counts.overdue, tone: "text-red-600" },
              { label: "In progress", value: data.counts.open, tone: "text-slate-700" },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className={`mt-1 text-2xl font-semibold ${s.tone}`}>{s.value}</p>
              </Card>
            ))}
          </div>

          {/* -------------------------------------------------- the working */}
          <Card>
            <CardHeader
              title="How it added up"
              subtitle="Every task that moved the number, and why"
            />
            <div className="divide-y divide-slate-100">
              {data.lines.length === 0 && (
                <p className="p-4 text-sm text-slate-500">
                  Nothing scored this month yet — no tasks completed and none overdue.
                </p>
              )}
              {data.lines.map((line) => {
                const o = OUTCOME[line.outcome] || OUTCOME.open;
                const Icon = o.icon;
                return (
                  <div key={line._id} className="flex items-start gap-3 p-3">
                    <Icon
                      size={15}
                      className={`mt-0.5 shrink-0 ${
                        line.points > 0
                          ? "text-green-600"
                          : line.points < 0
                            ? "text-red-500"
                            : "text-slate-400"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{line.title}</p>
                      <p className="text-xs text-slate-500">
                        {line.project ? `${line.project} · ` : ""}
                        {line.why}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {line.dueDate ? `Due ${shortDate(line.dueDate)}` : "No due date"}
                        {line.completedAt ? ` · Done ${shortDate(line.completedAt)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-semibold ${
                        line.points > 0
                          ? "text-green-700"
                          : line.points < 0
                            ? "text-red-600"
                            : "text-slate-400"
                      }`}
                    >
                      {line.points > 0 ? "+" : ""}
                      {line.points}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ------------------------------------------------- adjustments */}
          {data.adjustments.length > 0 && (
            <Card>
              <CardHeader title="Adjusted by HR" subtitle="Points a person decided, with the reason" />
              <div className="divide-y divide-slate-100">
                {data.adjustments.map((a) => (
                  <div key={a._id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">{a.reason}</p>
                      <p className="text-[11px] text-slate-400">
                        {a.by || "HR"} · {shortDate(a.at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-semibold ${
                        a.points > 0 ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {a.points > 0 ? "+" : ""}
                      {a.points}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ---------------------------------------------------- the trend */}
          {history.length > 1 && (
            <Card>
              <CardHeader title="The last six months" subtitle="Whether it is going the right way" />
              <div className="flex items-end gap-2 p-4 pt-0">
                {history.map((h) => (
                  <div key={h.period} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-500">{h.total}</span>
                    <div className="flex h-20 w-full items-end">
                      <div
                        className="w-full rounded-t bg-blue-500"
                        style={{ height: `${Math.max(4, (h.total / maxHistory) * 100)}%` }}
                        title={`${h.total} points · ${money(h.bonus)}`}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400">{h.period.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* --------------------------------------------------- the rules */}
          <Card>
            <CardHeader title="How points work" subtitle={data.rule.name} />
            <div className="grid gap-2 p-4 pt-0 text-sm sm:grid-cols-2">
              <Rule label="Finishing a task" value={`+${data.rule.completedPoints}`} good />
              <Rule label="On or before the due date" value={`+${data.rule.onTimeBonus}`} good />
              <Rule
                label="Finishing late"
                value={`−${data.rule.latePenalty}, then −${data.rule.latePerDay}/day (max −${data.rule.lateMaxPenalty})`}
              />
              <Rule label="Still open past the due date" value={`−${data.rule.overduePenalty}`} />
              <Rule
                label={`Rated ${data.rule.qualityMinRating}/5 or better`}
                value={`+${data.rule.qualityBonus}`}
                good
              />
              <Rule label="A task with no due date" value="Never counted as late" />
            </div>

            {data.rule.bonusSlabs?.length > 0 && (
              <div className="border-t border-slate-100 p-4">
                <p className="mb-2 text-xs font-medium text-slate-500">The bonus ladder</p>
                <div className="flex flex-wrap gap-2">
                  {data.rule.bonusSlabs.map((s) => (
                    <span
                      key={s.minPoints}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        data.total >= s.minPoints
                          ? "border-green-200 bg-green-50 text-green-800"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {s.minPoints}+ points → <strong>{money(s.amount)}</strong>
                      {s.label ? ` · ${s.label}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Rule({ label, value, good }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <Badge value={value} tone={good ? "green" : "slate"} />
    </div>
  );
}
