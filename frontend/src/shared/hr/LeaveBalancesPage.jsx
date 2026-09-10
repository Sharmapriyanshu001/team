import { useEffect, useState } from "react";
import { Scale } from "lucide-react";

import DataTable from "../components/DataTable";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Select,
} from "../components/ui";
import { leaveTypeLabel, yearOptions } from "./constants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

  /**
   * A column per leave type that actually has a quota, rather than all eleven.
   * A table with eight permanently empty columns is a table nobody reads
   * across.
   */
  const quotaTypes = Object.entries(data?.quotas || {})
    .filter(([, quota]) => quota > 0)
    .map(([type]) => type);

  const columns = [
    {
      key: "employee",
      header: "Who",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.employee.name}</p>
          <p className="text-xs text-slate-400">
            {row.employee.designation || row.employee.role?.replace(/_/g, " ") || "—"}
          </p>
        </div>
      ),
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
            return (
              <span className={used ? "font-medium text-slate-900" : "text-slate-400"}>{used}</span>
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
              const future = month > (data?.accrual?.monthsElapsed ?? 12);
              if (future) return <span className="text-slate-300">—</span>;
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
            render: (row) => (
              <span
                className={
                  (row.available ?? 0) === 0
                    ? "font-semibold text-red-600"
                    : "font-semibold text-emerald-600"
                }
              >
                {row.totalQuota ? row.available ?? 0 : "—"}
              </span>
            ),
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

  const opened = data?.rows?.find((r) => r.employee._id === openMonths);

  return (
    <div>
      <PageHeader
        title={title || "Leave Balances"}
        subtitle={
          subtitle ||
          (data
            ? `${data.rows?.length || 0} people · ${
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

      <Card>
        <CardHeader
          title={month ? `${MONTH_NAMES[month - 1]} ${year}` : `Balances for ${year}`}
          subtitle={
            month
              ? `What each person earned and took in ${MONTH_NAMES[month - 1]}, and what they were left holding`
              : "Approved leave only — pending requests are not counted against anybody"
          }
          action={
            month ? (
              <Button variant="ghost" size="sm" onClick={() => setMonth("")}>
                Back to the year
              </Button>
            ) : null
          }
        />
        <DataTable
          columns={columns}
          rows={data?.rows || []}
          loading={loading}
          emptyTitle="Nobody to show"
          emptyMessage="Active staff appear here once there are some on record."
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
