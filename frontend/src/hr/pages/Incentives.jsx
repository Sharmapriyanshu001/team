import { useCallback, useEffect, useState } from "react";
import { Minus, Plus, Settings2, Trophy } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";

/**
 * The incentive scheme from HR's side: everybody's month, ranked, with the
 * payout beside the points so a bonus run can be read off one table.
 *
 * The scoring is the same engine the employee's own screen uses, so the number
 * HR reads and the number the employee reads cannot differ — which matters,
 * because the employee can see theirs and will notice.
 */

const money = (n = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Incentives() {
  const { can } = useHrAccess();
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [detail, setDetail] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ points: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState(null);

  const canEdit = can("incentives", "edit");
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setData(null);
    hrApi
      .get("/hr/incentives", { params: { period } })
      .then(({ data: d }) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load incentives"));
    return () => {
      active = false;
    };
  }, [period, reloadKey]);

  const openEmployee = async (row) => {
    try {
      const { data: d } = await hrApi.get(`/hr/incentives/${row.employee._id}`, {
        params: { period },
      });
      setDetail(d);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that");
    }
  };

  const saveAdjustment = async () => {
    if (!adjustFor) return;
    setBusy(true);
    try {
      await hrApi.post("/hr/incentives/adjust", {
        employee: adjustFor.employee._id,
        period,
        points: Number(adjustForm.points),
        reason: adjustForm.reason,
      });
      setAdjustFor(null);
      setAdjustForm({ points: "", reason: "" });
      setNotice(`Adjustment recorded — ${adjustFor.employee.name} has been told`);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that");
      setAdjustFor(null);
    } finally {
      setBusy(false);
    }
  };

  const openRules = async () => {
    try {
      const { data: d } = await hrApi.get("/hr/incentive-rules");
      setRules(d.item);
      setRulesOpen(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the scheme");
    }
  };

  const saveRules = async () => {
    setBusy(true);
    try {
      const { data: d } = await hrApi.put("/hr/incentive-rules", rules);
      setRulesOpen(false);
      setNotice(d.message);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the scheme");
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "employee",
      header: "Person",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.employee.name}</p>
          <p className="text-xs text-slate-500">
            {row.employee.designation || row.employee.role.replace(/_/g, " ")}
          </p>
        </div>
      ),
    },
    {
      key: "delivery",
      header: "Delivery",
      render: (row) => (
        <span className="text-xs">
          <span className="text-green-700">{row.counts.completedOnTime} on time</span>
          {row.counts.completedLate > 0 && (
            <span className="text-amber-700"> · {row.counts.completedLate} late</span>
          )}
          {row.counts.overdue > 0 && (
            <span className="font-medium text-red-600"> · {row.counts.overdue} overdue</span>
          )}
          {/**
           * Delivered with no date agreed. Shown apart from "on time" rather
           * than counted into it — nobody set a deadline, so nothing was met.
           */}
          {row.counts.completedNoDate > 0 && (
            <span className="text-slate-400"> · {row.counts.completedNoDate} undated</span>
          )}
        </span>
      ),
    },
    {
      key: "taskPoints",
      header: "From tasks",
      render: (row) => <span className="text-slate-700">{row.taskPoints}</span>,
    },
    {
      key: "adjustmentPoints",
      header: "Adjusted",
      render: (row) =>
        row.adjustmentPoints ? (
          <span className={row.adjustmentPoints > 0 ? "text-green-700" : "text-red-600"}>
            {row.adjustmentPoints > 0 ? "+" : ""}
            {row.adjustmentPoints}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: "total",
      header: "Points",
      render: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{row.total}</span>
          {/**
           * A month never goes below zero. Saying so on the row stops "from
           * tasks −8 · points 0" reading as arithmetic that went wrong.
           */}
          {row.floored && (
            <p className="text-[11px] text-red-500">{row.raw} before the floor</p>
          )}
        </div>
      ),
    },
    {
      key: "bonus",
      header: "Bonus",
      render: (row) => (
        <div>
          <p className={row.bonus.amount ? "font-medium text-green-700" : "text-slate-400"}>
            {money(row.bonus.amount)}
          </p>
          {row.bonus.next && (
            <p className="text-[11px] text-slate-400">
              {row.bonus.next.pointsAway} to {money(row.bonus.next.amount)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canEdit ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setAdjustForm({ points: "", reason: "" });
                setAdjustFor(row);
              }}
            >
              Adjust
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incentives"
        subtitle="Points earned against deadlines, and the bonus they add up to"
      >
        <div className="flex flex-wrap gap-2">
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
          {canEdit && (
            <Button variant="outline" onClick={openRules}>
              <Settings2 size={15} /> Scheme
            </Button>
          )}
        </div>
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {!data ? (
        <Loader label="Scoring the month…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: "People", value: data.totals.people },
              {
                label: "Earning a bonus",
                value: `${data.totals.earning} of ${data.totals.people}`,
                tone: data.totals.earning ? "text-green-700" : "text-slate-900",
              },
              { label: "Bonus payable", value: money(data.totals.bonus), tone: "text-green-700" },
              {
                // Of the work that had a date to be judged against. An undated
                // month reports "—", not a 100% nobody earned.
                label: "On time",
                value:
                  data.totals.onTimeRate === null ? "—" : `${data.totals.onTimeRate}%`,
                tone: "text-green-700",
                hint:
                  data.totals.onTimeRate === null
                    ? "No task had a due date"
                    : `${data.totals.onTime} of ${data.totals.onTime + data.totals.late + data.totals.overdue} dated`,
              },
              { label: "Overdue", value: data.totals.overdue, tone: "text-red-600" },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className={`mt-1 text-xl font-semibold ${s.tone || "text-slate-900"}`}>
                  {s.value}
                </p>
                {s.hint && <p className="mt-0.5 text-[11px] text-slate-400">{s.hint}</p>}
              </Card>
            ))}
          </div>

          {/* ------------------------------------------- who is being paid */}

          {/**
           * The bonus run on its own, apart from the ranking.
           *
           * The table below answers "how did everybody do", and the answer is
           * mostly zeros — the people who actually earned something were
           * scattered down a column somebody had to read to find them. This
           * is the list a payroll message gets written from, so it is a list
           * rather than a thing to spot.
           */}
          <Card>
            <CardHeader
              title="Bonus earned"
              subtitle={
                data.earners?.length
                  ? `${data.earners.length} of ${data.totals.people} reached a step this month`
                  : "Nobody has reached the first step yet"
              }
              action={
                data.earners?.length ? (
                  <span className="text-sm font-semibold text-green-700">
                    {money(data.totals.bonus)}
                  </span>
                ) : null
              }
            />

            {data.earners?.length ? (
              <div className="divide-y divide-slate-100">
                {data.earners.map((row) => (
                  <div
                    key={row.employee._id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Trophy size={15} className="shrink-0 text-amber-500" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {row.employee.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {row.employee.designation || row.employee.department || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {row.label && <Badge value={row.label} tone="amber" />}
                      <span className="text-xs text-slate-500">{row.total} pts</span>
                      <span className="text-sm font-semibold text-green-700">
                        {money(row.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                The first step of the ladder starts at{" "}
                {data.rule?.bonusSlabs?.[0]?.minPoints ?? 0} points.
              </p>
            )}
          </Card>

          {/* --------------------------------------------- everybody, ranked */}

          <Card>
            <DataTable
              columns={columns}
              rows={data.items}
              onRowClick={openEmployee}
              emptyTitle="Nobody to score"
              emptyMessage="Employees and operations managers appear here once they have tasks."
            />
          </Card>
        </>
      )}

      {/* --------------------------------------------------- one person */}

      <Modal
        open={Boolean(detail)}
        title={detail?.employee?.name || ""}
        subtitle={`${period} · ${detail?.total ?? 0} points · ${money(detail?.bonus?.amount)}`}
        onClose={() => setDetail(null)}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-4">
            {detail.floored && (
              <Alert>
                Tasks and adjustments came to {detail.raw}. A month never goes below zero, so the
                total reads 0 — an award here moves the raw figure, not the floored one.
              </Alert>
            )}

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {detail.lines.length === 0 && (
                <p className="p-3 text-sm text-slate-500">Nothing scored this month.</p>
              )}
              {detail.lines.map((line) => (
                <div key={line._id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{line.title}</p>
                    <p className="text-xs text-slate-500">{line.why}</p>
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
              ))}
            </div>

            {detail.adjustments.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Adjustments</p>
                <div className="space-y-1.5">
                  {detail.adjustments.map((a) => (
                    <div
                      key={a._id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-slate-800">{a.reason}</p>
                        <p className="text-[11px] text-slate-400">
                          {a.by} · {shortDate(a.at)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-semibold ${
                          a.points > 0 ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {a.points > 0 ? "+" : ""}
                        {a.points}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------ adjustment */}

      <Modal
        open={Boolean(adjustFor)}
        title={`Adjust points for ${adjustFor?.employee?.name || ""}`}
        subtitle={`${period} · they will be notified`}
        onClose={() => setAdjustFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjustFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={saveAdjustment}
              disabled={busy || !Number(adjustForm.points) || !adjustForm.reason.trim()}
            >
              {busy ? "Saving…" : "Record it"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert>
            This sits beside the task score rather than changing it, so anyone reading the total can
            see which part the system worked out and which part a person decided.
          </Alert>

          <Field label="Points" hint="Positive to award, negative to deduct" required>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAdjustForm({
                    ...adjustForm,
                    points: String(-Math.abs(Number(adjustForm.points) || 5)),
                  })
                }
              >
                <Minus size={13} />
              </Button>
              <Input
                type="number"
                value={adjustForm.points}
                onChange={(e) => setAdjustForm({ ...adjustForm, points: e.target.value })}
                placeholder="e.g. 10 or -5"
                required
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAdjustForm({
                    ...adjustForm,
                    points: String(Math.abs(Number(adjustForm.points) || 5)),
                  })
                }
              >
                <Plus size={13} />
              </Button>
            </div>
          </Field>

          <Field label="Reason" hint="The employee sees this on their own screen" required>
            <Textarea
              rows={3}
              value={adjustForm.reason}
              onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
              placeholder="Covered the client escalation over the weekend"
              required
            />
          </Field>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- rules */}

      <Modal
        open={rulesOpen}
        title="The incentive scheme"
        subtitle="What points are worth, and what they pay"
        onClose={() => setRulesOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRulesOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveRules} disabled={busy}>
              {busy ? "Saving…" : "Save scheme"}
            </Button>
          </>
        }
      >
        {rules && (
          <div className="space-y-4">
            <Alert>
              Points are worked out from the tasks rather than banked, so changing these numbers
              re-scores past months too. Worth announcing rather than slipping in mid-month.
            </Alert>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Finishing a task">
                <Input
                  type="number"
                  value={rules.completedPoints}
                  onChange={(e) => setRules({ ...rules, completedPoints: e.target.value })}
                />
              </Field>
              <Field label="On-time bonus">
                <Input
                  type="number"
                  value={rules.onTimeBonus}
                  onChange={(e) => setRules({ ...rules, onTimeBonus: e.target.value })}
                />
              </Field>
              <Field label="Late penalty (flat)">
                <Input
                  type="number"
                  value={rules.latePenalty}
                  onChange={(e) => setRules({ ...rules, latePenalty: e.target.value })}
                />
              </Field>
              <Field label="Late penalty per day">
                <Input
                  type="number"
                  value={rules.latePerDay}
                  onChange={(e) => setRules({ ...rules, latePerDay: e.target.value })}
                />
              </Field>
              <Field label="Most a late task can cost">
                <Input
                  type="number"
                  value={rules.lateMaxPenalty}
                  onChange={(e) => setRules({ ...rules, lateMaxPenalty: e.target.value })}
                />
              </Field>
              <Field label="Still open past the due date">
                <Input
                  type="number"
                  value={rules.overduePenalty}
                  onChange={(e) => setRules({ ...rules, overduePenalty: e.target.value })}
                />
              </Field>
              <Field label="Quality bonus at rating">
                <Input
                  type="number"
                  value={rules.qualityMinRating}
                  onChange={(e) => setRules({ ...rules, qualityMinRating: e.target.value })}
                />
              </Field>
              <Field label="Quality bonus points">
                <Input
                  type="number"
                  value={rules.qualityBonus}
                  onChange={(e) => setRules({ ...rules, qualityBonus: e.target.value })}
                />
              </Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">
                The bonus ladder — highest step reached is what pays
              </p>
              <div className="space-y-2">
                {(rules.bonusSlabs || []).map((slab, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      type="number"
                      value={slab.minPoints}
                      onChange={(e) => {
                        const next = [...rules.bonusSlabs];
                        next[i] = { ...slab, minPoints: e.target.value };
                        setRules({ ...rules, bonusSlabs: next });
                      }}
                      placeholder="Points"
                      className="w-28"
                    />
                    <Input
                      type="number"
                      value={slab.amount}
                      onChange={(e) => {
                        const next = [...rules.bonusSlabs];
                        next[i] = { ...slab, amount: e.target.value };
                        setRules({ ...rules, bonusSlabs: next });
                      }}
                      placeholder="Bonus ₹"
                      className="w-32"
                    />
                    <Input
                      value={slab.label || ""}
                      onChange={(e) => {
                        const next = [...rules.bonusSlabs];
                        next[i] = { ...slab, label: e.target.value };
                        setRules({ ...rules, bonusSlabs: next });
                      }}
                      placeholder="Label"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRules({
                          ...rules,
                          bonusSlabs: rules.bonusSlabs.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Minus size={13} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRules({
                      ...rules,
                      bonusSlabs: [...(rules.bonusSlabs || []), { minPoints: 0, amount: 0, label: "" }],
                    })
                  }
                >
                  <Plus size={13} /> Add a step
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
