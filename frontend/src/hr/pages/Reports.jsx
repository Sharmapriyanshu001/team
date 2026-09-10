import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { UserMinus, UserPlus } from "lucide-react";

import hrApi from "../hrApi";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify } from "../../shared/format";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  Select,
} from "../../shared/components/ui";
import { leaveTypeLabel, monthOptions, shortDate, yearOptions } from "../../shared/hr/constants";

/**
 * The month HR is asked about.
 *
 * Every figure is counted from the collections on read, so the report is right
 * on the 3rd rather than on the day somebody remembers to total it up — and so
 * there is nothing to regenerate when a leave is approved after the fact.
 *
 * This is the analytics screen. The reporting *chain* — what managers send up
 * to HR and what HR sends to the Admin — is a different thing and lives on
 * Report Chain.
 */

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const PIE_COLOURS = ["#2563eb", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

export default function Reports() {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const changePeriod = useCallback((patch) => {
    setLoading(true);
    setPeriod((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    hrApi
      .get("/hr/reports", { params: period })
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load reports"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [period]);

  if (loading && !data) return <Loader label="Building the report…" />;

  const attendanceBars = Object.entries(data?.attendance?.counts || {}).map(([status, count]) => ({
    status: prettify(status),
    key: status,
    count,
  }));

  const leaveSlices = (data?.leave?.byType || []).map((row) => ({
    name: leaveTypeLabel(row.type),
    value: row.days,
  }));

  return (
    <div>
      <PageHeader title="HR Reports" subtitle="Headcount, attendance, leave and hiring by month">
        <Select
          value={period.month}
          onChange={(e) => changePeriod({ month: Number(e.target.value) })}
          options={monthOptions}
          className="w-auto"
        />
        <Select
          value={period.year}
          onChange={(e) => changePeriod({ year: Number(e.target.value) })}
          options={yearOptions}
          className="w-auto"
        />
      </PageHeader>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active headcount", data?.headcount?.active ?? 0, `${data?.headcount?.inactive ?? 0} inactive`],
          ["Attendance", `${data?.attendance?.rate ?? 0}%`, `${data?.attendance?.marked ?? 0} days marked`],
          ["Leave days approved", data?.leave?.approvedDays ?? 0, `${data?.leave?.pending ?? 0} still waiting`],
          ["Hired this month", data?.recruitment?.hired ?? 0, `${data?.joiners?.length ?? 0} joined`],
        ].map(([label, value, hint]) => (
          <Card key={label}>
            <div className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="text-xl font-bold text-slate-900">{value}</p>
              <p className="text-[11px] text-slate-400">{hint}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance this month" subtitle="Days marked, by status" />
          <div className="p-4">
            {attendanceBars.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={attendanceBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="status" {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {attendanceBars.map((row) => (
                      <Cell key={row.key} fill={STATUS_COLORS[row.key] || CHART.blue} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={UserPlus}
                title="Nothing marked yet"
                message="Attendance for this month has not been taken."
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Leave taken" subtitle="Approved days, by type" />
          <div className="p-4">
            {leaveSlices.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={leaveSlices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {leaveSlices.map((slice, index) => (
                      <Cell key={slice.name} fill={PIE_COLOURS[index % PIE_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={UserMinus}
                title="No approved leave"
                message="Nothing was taken in this month."
              />
            )}

            {leaveSlices.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {leaveSlices.map((slice, index) => (
                  <li key={slice.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: PIE_COLOURS[index % PIE_COLOURS.length] }}
                    />
                    {slice.name} · {slice.value}d
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Joined this month" subtitle="New starters" />
          {data?.joiners?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.joiners.map((person) => (
                <li
                  key={person._id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{person.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {person.designation || (person.role || "").replace(/_/g, " ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {shortDate(person.joiningDate)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={UserPlus} title="Nobody joined this month" />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Most days absent"
            subtitle="This month — worth a conversation before it becomes a pattern"
          />
          {data?.mostAbsent?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.mostAbsent.map((person) => (
                <li
                  key={person._id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{person.name}</p>
                    <p className="truncate text-xs text-slate-400">{person.designation || "—"}</p>
                  </div>
                  <Badge tone="red">
                    {person.days} day{person.days === 1 ? "" : "s"}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserMinus}
              title="No absences recorded"
              message="Nobody was marked absent this month."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
