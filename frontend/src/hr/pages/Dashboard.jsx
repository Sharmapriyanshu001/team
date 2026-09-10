import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarCheck,
  CalendarOff,
  UserPlus,
  UsersRound,
} from "lucide-react";

import hrApi from "../hrApi";
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
import {
  dateRange,
  leaveTypeLabel,
  monthOptions,
  shortDate,
  stageLabel,
  yearOptions,
} from "../../shared/hr/constants";

/**
 * Where an HR account lands.
 *
 * The same figures the admin panel's HR overview shows, from the same query —
 * /hr/dashboard and /admin/hr/overview are the same handler, so the two can
 * never disagree about how many people work here. Everything is counted from
 * the collections on read; nothing is stored or seeded, so an empty pipeline
 * renders as an empty pipeline rather than as an invented one.
 */

const TONES = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
};

const Stat = ({ icon: Icon, label, value, hint, tone = "blue", to }) => {
  const body = (
    <div className="flex items-start gap-3 p-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );

  return (
    <Card className={to ? "transition-shadow hover:shadow-md" : ""}>
      {to ? <Link to={to}>{body}</Link> : body}
    </Card>
  );
};

export default function Dashboard() {
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
      .get("/hr/dashboard", { params: period })
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load the dashboard")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [period]);

  if (loading && !data) return <Loader label="Loading HR…" />;

  const headcount = data?.headcount || {};
  const leave = data?.leave || {};
  const recruitment = data?.recruitment || {};
  const attendance = data?.attendance || {};

  const roleRows = Object.entries(headcount.byRole || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <PageHeader
        title="HR Dashboard"
        subtitle="Who works here, who is joining, and who is away"
      >
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
        <Stat
          icon={UsersRound}
          label="Headcount"
          value={headcount.active ?? 0}
          hint={`${headcount.total ?? 0} on record · ${headcount.joinedThisMonth ?? 0} joined this month`}
          to="/hr/employees"
        />
        <Stat
          icon={CalendarOff}
          label="Leave waiting"
          value={leave.pending ?? 0}
          hint={`${leave.thisMonth ?? 0} covering this month`}
          tone="amber"
          to="/hr/leave?status=pending"
        />
        <Stat
          icon={UserPlus}
          label="In the hiring pipeline"
          value={recruitment.open ?? 0}
          hint={`${recruitment.hiredThisMonth ?? 0} hired this month`}
          tone="violet"
          to="/hr/recruitment"
        />
        <Stat
          icon={CalendarCheck}
          label="Attendance"
          value={`${attendance.rate ?? 0}%`}
          hint={`${attendance.marked ?? 0} days marked this month`}
          tone="emerald"
          to="/hr/attendance"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Away today"
            subtitle="Approved leave covering today"
            action={
              <Link
                to="/hr/leave"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                All leave <ArrowRight size={13} />
              </Link>
            }
          />
          {leave.onLeaveToday?.length ? (
            <ul className="divide-y divide-slate-100">
              {leave.onLeaveToday.map((row) => (
                <li key={row._id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {row.employee?.name || "Someone no longer on record"}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {row.employee?.designation || row.employee?.department || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge value={row.type}>{leaveTypeLabel(row.type)}</Badge>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {dateRange(row.fromDate, row.toDate)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarCheck}
              title="Everybody is in"
              message="No approved leave covers today."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Interviews coming up"
            subtitle="Scheduled rounds, soonest first"
            action={
              <Link
                to="/hr/recruitment"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Recruitment <ArrowRight size={13} />
              </Link>
            }
          />
          {recruitment.upcoming?.length ? (
            <ul className="divide-y divide-slate-100">
              {recruitment.upcoming.map((row, index) => (
                <li
                  key={`${row.candidateId}-${row.round}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{row.candidate}</p>
                    <p className="truncate text-xs text-slate-400">
                      {row.round}
                      {row.position ? ` · ${row.position}` : ""}
                      {row.interviewerName ? ` · ${row.interviewerName}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-500">{shortDate(row.scheduledAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserPlus}
              title="Nothing scheduled"
              message="Rounds you schedule on a candidate show up here."
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Headcount by role" subtitle="Everybody on the payroll" />
          {roleRows.length ? (
            <ul className="divide-y divide-slate-100">
              {roleRows.map(([role, count]) => (
                <li key={role} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm capitalize text-slate-700">
                    {role.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={UsersRound} title="Nobody on record yet" />
          )}
        </Card>

        <Card>
          <CardHeader title="Hiring pipeline" subtitle="Candidates by stage" />
          {Object.keys(recruitment.pipeline || {}).length ? (
            <ul className="divide-y divide-slate-100">
              {Object.entries(recruitment.pipeline).map(([stage, count]) => (
                <li key={stage} className="flex items-center justify-between px-4 py-2.5">
                  <Badge value={stage}>{stageLabel(stage)}</Badge>
                  <span className="text-sm font-semibold text-slate-900">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserPlus}
              title="No candidates yet"
              message="Add one from Candidates to start the pipeline."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
