import { useEffect, useMemo, useState } from "react";
import { Scale } from "lucide-react";

import DataTable from "../components/DataTable";
import Toolbar from "../components/Toolbar";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Select,
} from "../components/ui";
import { leaveTypeLabel, shortDate, yearOptions } from "./constants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Totals are money-ish: one decimal, never a floating-point tail. */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * One counter above the table.
 *
 * Built to the same shape as the attendance page's, because the two screens
 * answer the same kind of question — "where does the month stand" — and a
 * panel where every screen invents its own counter is a panel nobody learns.
 */
function Tile({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-700",
    red: "text-red-600",
  };

  return (
    <Card className="px-3.5 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </Card>
  );
}

/**
 * What everybody has taken this year, against what the policies grant.
 *
 * Computed by the server on read from the approved leaves — there is no stored
 * balance anywhere, which is why this cannot drift out of step with the
 * requests screen.
 */
export default function LeaveBalancesPage({ api, basePath, title, subtitle }) {
  const [year, setYear] = useState(new Date().getFullYear());
  /**
   * "" is the whole year; 1-12 is one month.
   *
   * The year on its own answers "how is everybody doing", which is the annual
   * question. Payroll asks the other one — "what did March look like" — and
   * before this the only way to get it was to open one person at a time and
   * read down a column.
   */
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  // Whose full-year record is open, if any
  const [openMonths, setOpenMonths] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .get(`${basePath}/leaves/balances`, { params: { year } })
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load balances"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, year]);

  const rows = useMemo(() => data?.rows || [], [data]);

  /**
   * A column per leave type that actually has a quota, rather than all eleven.
   * A table with eight permanently empty columns is a table nobody reads
   * across.
   */
  const quotaTypes = Object.entries(data?.quotas || {})
    .filter(([, quota]) => quota > 0)
    .map(([type]) => type);

  const monthsElapsed = data?.accrual?.monthsElapsed ?? 12;
  const futureMonth = Boolean(month) && month > monthsElapsed;

  /**
   * The year in five numbers.
   *
   * A table of eighteen rows does not answer "is anybody in trouble" — you
   * have to read every row to find out, and the row that matters is the one
   * nobody scrolled to. These are the four questions HR actually opens this
   * screen with, and the fifth is the one they should have asked.
   */
  const totals = useMemo(() => {
    const sum = (pick) => round1(rows.reduce((t, row) => t + (pick(row) || 0), 0));

    return {
      accrued: sum((r) => r.accrued),
      taken: sum((r) => r.totalUsed),
      available: sum((r) => r.available),
      pendingDays: sum((r) => r.pending?.days),
      pendingRequests: rows.reduce((t, r) => t + (r.pending?.requests || 0), 0),
      /** Below nil, which `available` floors away and this does not. */
      overdrawnPeople: rows.filter((r) => (r.net ?? 0) < 0).length,
      overdrawnDays: round1(-rows.reduce((t, r) => t + Math.min(0, r.net ?? 0), 0)),
    };
  }, [rows]);

  /** The same five, for one month, when a month is what is on screen. */
  const monthTotals = useMemo(() => {
    if (!month) return null;

    const cells = rows.map((row) => row.months?.[month - 1] || {});
    const sum = (key) => round1(cells.reduce((t, cell) => t + (cell[key] || 0), 0));

    return {
      accrued: sum("accrued"),
      taken: sum("taken"),
      balance: sum("balance"),
      tookLeave: cells.filter((cell) => (cell.taken || 0) > 0).length,
      negative: cells.filter((cell) => (cell.balance ?? 0) < 0).length,
    };
  }, [rows, month]);

  /**
   * Searching happens here rather than on the server.
   *
   * Every row of the year arrives in one response already — it has to, because
   * the monthly record is computed from the same pass — so asking the server
   * again to filter eighteen objects already in memory would be slower and
   * would flash a loader at somebody typing a name.
   *
   * The order is the server's, which is by name: the order somebody scanning
   * the sheet for a colleague reads down.
   */
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) =>
      [
        row.employee.name,
        row.employee.designation,
        row.employee.department,
        row.employee.email,
        row.employee.role,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [rows, search]);

  const columns = [
    {
      key: "employee",
      header: "Who",
      render: (row) => {
        /**
         * Somebody who joined in August has been earning since August, so
         * their "earned so far" is a fraction of everybody else's. Without
         * the date on the row that reads as a bug in the page, and it is the
         * question this screen was asked most often.
         */
        const joined = row.employee.joiningDate ? new Date(row.employee.joiningDate) : null;
        const prorated = joined && joined.getFullYear() === (data?.year ?? year);

        return (
          <div>
            <p className="font-medium text-slate-900">{row.employee.name}</p>
            <p className="text-xs text-slate-400">
              {row.employee.designation || row.employee.role?.replace(/_/g, " ") || "—"}
            </p>
            {prorated && (
              <p className="text-[11px] text-slate-400">
                joined {shortDate(row.employee.joiningDate)}
              </p>
            )}
          </div>
        );
      },
    },
    /**
     * The per-type columns are annual totals, so they belong to the annual
     * view only. Printing "3 casual" beside a March row would read as three
     * days taken in March.
     */
    ...(month
      ? []
      : quotaTypes.map((type) => ({
          key: type,
          header: leaveTypeLabel(type),
          render: (row) => {
            const used = row.used?.[type] || 0;
            const quota = data?.quotas?.[type] || 0;
            /**
             * Against its own quota, not just as a number.
             *
             * "Can book now" is checked against the total allowance, so a
             * person can be well inside it and still have taken ten sick days
             * out of six. That overrun was invisible here until the quota sat
             * beside the figure.
             */
            const over = quota > 0 && used > quota;

            return (
              <span className="whitespace-nowrap">
                <span
                  className={
                    over
                      ? "font-semibold text-red-600"
                      : used
                        ? "font-medium text-slate-900"
                        : "text-slate-400"
                  }
                >
                  {used}
                </span>
                <span className="text-[11px] text-slate-400"> of {quota}</span>
              </span>
            );
          },
        }))),

    ...(month
      ? /* ---------------------------------------------- one month's sheet */
        [
          {
            key: "earnedInMonth",
            header: `Earned in ${MONTH_NAMES[month - 1]}`,
            render: (row) => {
              const m = row.months?.[month - 1];
              return m?.accrued ? (
                <span className="font-medium text-slate-900">+{m.accrued}</span>
              ) : (
                <span className="text-slate-300">—</span>
              );
            },
          },
          {
            key: "takenInMonth",
            header: `Taken in ${MONTH_NAMES[month - 1]}`,
            render: (row) => {
              const m = row.months?.[month - 1];
              return m?.taken ? (
                <span className="font-medium text-amber-700">−{m.taken}</span>
              ) : (
                <span className="text-slate-300">0</span>
              );
            },
          },
          {
            key: "balanceInMonth",
            header: "Balance at month end",
            render: (row) => {
              const m = row.months?.[month - 1];
              if (futureMonth) return <span className="text-slate-300">—</span>;
              return (
                <span
                  className={`font-semibold ${
                    (m?.balance ?? 0) < 0 ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {m?.balance ?? 0}
                </span>
              );
            },
          },
        ]
      : /* ------------------------------------------------- the whole year */
        [
          {
            key: "totalUsed",
            header: "Taken",
            render: (row) => <span className="font-semibold text-slate-900">{row.totalUsed}</span>,
          },
          {
            /**
             * Earned, not granted. The allowance arrives a month at a time, so
             * this is what the year has actually put in their hand by now —
             * the figure a booking should be checked against, and the one that
             * stops somebody in February being told they have eleven days.
             */
            key: "accrued",
            header: "Earned so far",
            render: (row) => (
              <div>
                <p className="font-medium text-slate-900">{row.accrued ?? 0}</p>
                <p className="text-[11px] text-slate-400">of {row.totalQuota} a year</p>
              </div>
            ),
          },
          {
            key: "available",
            header: "Can book now",
            render: (row) => {
              if (!row.totalQuota) return <span className="text-slate-400">—</span>;

              /**
               * Three different answers, which this column used to print as
               * two. `available` is floored at zero, so somebody two days in
               * the red and somebody exactly at nil both read "0" — and only
               * one of those is a conversation with a manager. The signed
               * figure separates them.
               */
              const net = row.net ?? row.available ?? 0;

              if (net < 0) {
                return (
                  <div>
                    <p className="font-semibold text-red-600">{net}</p>
                    <p className="text-[11px] text-red-400">overdrawn</p>
                  </div>
                );
              }

              if (net === 0) {
                return (
                  <div>
                    <p className="font-semibold text-amber-700">0</p>
                    <p className="text-[11px] text-slate-400">nothing left</p>
                  </div>
                );
              }

              return <span className="font-semibold text-emerald-600">{row.available ?? 0}</span>;
            },
          },
        ]),
    {
      key: "months",
      header: "",
      className: "text-right",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpenMonths(openMonths === row.employee._id ? null : row.employee._id);
          }}
        >
          {openMonths === row.employee._id ? "Hide" : "Month by month"}
        </Button>
      ),
    },
  ];

  const opened = rows.find((r) => r.employee._id === openMonths);

  return (
    <div>
      <PageHeader
        title={title || "Leave Balances"}
        subtitle={
          subtitle ||
          (data
            ? `${rows.length} people · ${
                data.policies?.length || 0
              } active policies granting ${Object.values(data.quotas || {}).reduce(
                (sum, n) => sum + n,
                0
              )} days a year`
            : "Counted from approved leave")
        }
      >
        <Select
          value={month}
          onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}
          className="w-auto"
          options={[
            { value: "", label: "Whole year" },
            ...MONTH_NAMES.map((name, i) => ({ value: i + 1, label: name })),
          ]}
        />
        <Select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          options={yearOptions}
          className="w-auto"
        />
      </PageHeader>

      <Alert>{error}</Alert>

      {/* ------------------------------------------------- the year in five */}
      {!loading && !month && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          <Tile
            label="Earned so far"
            value={totals.accrued}
            hint={`across ${rows.length} ${rows.length === 1 ? "person" : "people"}`}
          />
          <Tile label="Taken" value={totals.taken} hint={`approved days in ${year}`} />
          <Tile
            label="Pending"
            value={totals.pendingDays}
            hint={
              totals.pendingRequests
                ? `${totals.pendingRequests} request${
                    totals.pendingRequests === 1 ? "" : "s"
                  } awaiting a decision`
                : "nothing waiting"
            }
            tone={totals.pendingDays ? "amber" : "slate"}
          />
          <Tile
            label="Can book now"
            value={totals.available}
            hint="days in hand across the team"
            tone="emerald"
          />
          <Tile
            label="Overdrawn"
            value={totals.overdrawnPeople}
            hint={
              totals.overdrawnPeople
                ? `${totals.overdrawnDays} days beyond what was earned`
                : "nobody is past their earned days"
            }
            tone={totals.overdrawnPeople ? "red" : "slate"}
          />
        </div>
      )}

      {/* ------------------------------------------------ the month in five */}
      {!loading && month && !futureMonth && monthTotals && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          <Tile
            label={`Earned in ${MONTH_NAMES[month - 1]}`}
            value={monthTotals.accrued}
            hint={`${data?.accrual?.perMonth ?? 0} a head`}
          />
          <Tile
            label={`Taken in ${MONTH_NAMES[month - 1]}`}
            value={monthTotals.taken}
            hint="approved days"
            tone={monthTotals.taken ? "amber" : "slate"}
          />
          <Tile
            label="Who took leave"
            value={monthTotals.tookLeave}
            hint={`of ${rows.length} on the payroll`}
          />
          <Tile
            label="Held at month end"
            value={monthTotals.balance}
            hint="added up across everybody"
            tone="emerald"
          />
          <Tile
            label="Overdrawn"
            value={monthTotals.negative}
            hint={
              monthTotals.negative
                ? "were below nil at month end"
                : "nobody was below nil that month"
            }
            tone={monthTotals.negative ? "red" : "slate"}
          />
        </div>
      )}

      <Card>
        <CardHeader
          title={month ? `${MONTH_NAMES[month - 1]} ${year}` : `Balances for ${year}`}
          subtitle={
            month
              ? `What each person earned and took in ${MONTH_NAMES[month - 1]}, and what they were left holding`
              : "Approved leave only — anything still pending is counted against nobody"
          }
          action={
            month ? (
              <Button variant="ghost" size="sm" onClick={() => setMonth("")}>
                Back to the year
              </Button>
            ) : null
          }
        />

        <Toolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search a name, a designation or a department"
        />

        <DataTable
          columns={columns}
          rows={visibleRows}
          loading={loading}
          emptyTitle={search ? "Nobody matches that" : "Nobody to show"}
          emptyMessage={
            search
              ? "Try a shorter search, or clear it to see everybody."
              : "Active staff appear here once there are some on record."
          }
        />
      </Card>

      {/**
       * The monthly record, for one person at a time.
       *
       * Under the table rather than inside it: twelve months across a row that
       * already carries a column per leave type is a horizontal scroll nobody
       * reads. Opened per person because the question is always about a
       * person — "when did Meera's balance go negative" — never about
       * everybody at once.
       */}
      {opened && (
        <Card className="mt-3">
          <CardHeader
            title={`${opened.employee.name} — the year, month by month`}
            subtitle={`${data.accrual.perMonth} day${
              data.accrual.perMonth === 1 ? "" : "s"
            } earned each month · ${opened.accrued} earned and ${opened.totalUsed} taken so far`}
            action={
              <Button variant="ghost" size="sm" onClick={() => setOpenMonths(null)}>
                Close
              </Button>
            }
          />

          {/**
           * A card per month rather than a twelve-row table.
           *
           * The question this answers is "which month did it go wrong in", and
           * that is a thing you scan for, not read down. Twelve tiles across
           * three rows put the whole year in one glance; a table made you
           * compare numbers line by line to find the one that dipped.
           *
           * Months that have not arrived are drawn flat and empty rather than
           * as zeros — nothing has happened in them, and a column of 0s reads
           * as "took no leave" instead of "has not happened".
           */}
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
            {opened.months.map((m) => {
              const future = m.month > data.accrual.monthsElapsed;
              const short = MONTH_NAMES[m.month - 1].slice(0, 3);

              return (
                <div
                  key={m.month}
                  className={`rounded-lg border px-3 py-2.5 ${
                    future
                      ? "border-dashed border-slate-200 bg-slate-50/40"
                      : m.balance < 0
                        ? "border-red-200 bg-red-50/50"
                        : m.taken > 0
                          ? "border-amber-200 bg-amber-50/40"
                          : "border-slate-200 bg-white"
                  }`}
                >
                  <p
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      future ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {short}
                  </p>

                  {future ? (
                    <p className="mt-1 text-lg font-semibold text-slate-300">—</p>
                  ) : (
                    <>
                      <p
                        className={`mt-0.5 text-lg font-semibold ${
                          m.balance < 0 ? "text-red-600" : "text-slate-900"
                        }`}
                      >
                        {m.balance}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        <span className="text-emerald-700">+{m.accrued}</span>
                        {m.taken > 0 && <span className="text-amber-700"> −{m.taken}</span>}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
            The big number is what was in hand at the end of that month. Below it, what was earned
            and what was taken.
          </p>
        </Card>
      )}

      {!loading && !quotaTypes.length && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Scale size={13} />
          No active policy grants any days yet, so there is nothing to count against. Set an annual
          quota under Leave → Policies.
        </p>
      )}
    </div>
  );
}
