import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarOff,
  CalendarCheck,
  IdCard,
  UserPlus,
  UsersRound,
  ArrowRight,
} from "lucide-react";

import adminApi from "../../adminApi";
import usePermissions from "../../hooks/usePermissions";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  Select,
} from "../../../shared/components/ui";
import {
  leaveTypeLabel,
  monthOptions,
  shortDate,
  dateRange,
  stageLabel,
  yearOptions,
} from "./constants";

/**
 * Where an HR account lands, and where an admin looks to see the people side
 * of the company in one place.
 *
 * Every figure comes from /admin/hr/overview, which counts them from the
 * collections on read. Nothing here is stored or seeded — an empty pipeline
 * renders as an empty pipeline rather than as an invented one.
 *
 * The layout answers a complaint the screenshot made obvious: on a quiet day
 * this page was four bordered boxes of centred nothing, which reads as a page
 * that failed to load. Two things fixed it. The panels that are usually empty
 * now say so on one line and shrink to fit, and the breakdowns that are always
 * short sit in a narrow column beside the lists rather than each taking half
 * the screen. Nothing was removed; it stopped being spread over three screens.
 */

const Stat = ({ icon: Icon, label, value, hint, tone = "blue", to }) => {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
  };

  const body = (
    <div className="flex items-center gap-3 p-3.5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-xl font-bold leading-tight text-slate-900">{value}</p>
        {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );

  return (
    <Card className={to ? "transition-shadow hover:shadow-md" : ""}>
      {to ? <Link to={to}>{body}</Link> : body}
    </Card>
  );
};

/**
 * One line of a breakdown: a label, a count, and how big a share it is.
 *
 * The bar is what makes these two panels worth their space. "Employee 6,
 * Operations Manager 5, Manager 3" is three numbers somebody has to hold in
 * their head to compare; the same three with a bar behind them is a shape,
 * read at a glance and gone.
 */
function ShareRow({ label, count, total, tone = "bg-blue-500" }) {
  const share = total ? Math.round((count / total) * 100) : 0;

  return (
    <li className="px-4 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-slate-700">{label}</span>
        <span className="shrink-0 font-semibold text-slate-900">{count}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${share}%` }} />
      </div>
    </li>
  );
}

/** The "go and do something about it" link in a panel's corner. */
function More({ to, children }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
    >
      {children} <ArrowRight size={13} />
    </Link>
  );
}

export default function HrOverview() {
  const { isFullAdmin } = usePermissions();
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

    adminApi
      .get("/admin/hr/overview", { params: period })
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) =>
          active && setError(err.response?.data?.message || "Could not load the HR overview")
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

  const byRole = headcount.byRole || {};
  const roleRows = Object.entries(byRole).sort((a, b) => b[1] - a[1]);
  const roleTotal = roleRows.reduce((sum, [, count]) => sum + count, 0);

  const pipeline = Object.entries(recruitment.pipeline || {});
  const pipelineTotal = pipeline.reduce((sum, [, count]) => sum + count, 0);

  const awayToday = leave.onLeaveToday || [];
  const interviews = recruitment.upcoming || [];

  return (
    <div>
      <PageHeader title="HR Overview" subtitle="Who works here, who is joining, and who is away">
        {/* Only an administrator may create a department login — the route
            behind this refuses everybody else, so it is not offered to them */}
        {isFullAdmin && (
          <Link to="/admin/hr/accounts">
            <Button variant="outline">
              <IdCard size={15} />
              HR Accounts
            </Button>
          </Link>
        )}
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

      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={UsersRound}
          label="All Employees"
          value={headcount.active ?? 0}
          hint={`${headcount.total ?? 0} on record · ${headcount.joinedThisMonth ?? 0} joined this month`}
          to="/admin/employees"
        />
        <Stat
          icon={CalendarOff}
          label="Leave waiting"
          value={leave.pending ?? 0}
          hint={`${leave.thisMonth ?? 0} covering this month`}
          tone="amber"
          to="/admin/hr/leave?status=pending"
        />
        <Stat
          icon={UserPlus}
          label="In the hiring pipeline"
          value={recruitment.open ?? 0}
          hint={`${recruitment.hiredThisMonth ?? 0} hired this month`}
          tone="violet"
          to="/admin/hr/recruitment"
        />
        <Stat
          icon={CalendarCheck}
          label="Attendance"
          value={`${attendance.rate ?? 0}%`}
          hint={`${attendance.marked ?? 0} days marked this month`}
          tone="emerald"
          to="/admin/employees/attendance"
        />
      </div>

      {/**
       * Two columns of unequal weight, and items-start on both.
       *
       * The left holds what changes daily and is worth reading in full; the
       * right holds the two breakdowns, which are five short lines each and
       * were being given half the screen to say so. A grid row stretches its
       * children to match the tallest, so items-start is what lets a one-line
       * panel be one line high instead of drawing its border down the side of
       * a taller neighbour with nothing inside it.
       */}
      <div className="grid items-start gap-3 xl:grid-cols-3">
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:col-span-2">
          {/* ---------------------------------------------- away today */}
          <Card>
            <CardHeader
              title="Away today"
              subtitle={
                awayToday.length
                  ? `${awayToday.length} on approved leave`
                  : "Approved leave covering today"
              }
              action={<More to="/admin/hr/leave">All leave</More>}
            />
            {awayToday.length ? (
              <ul className="divide-y divide-slate-100">
                {awayToday.map((row) => (
                  <li key={row._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {row.employee?.name || "Someone"}
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
                compact
                icon={CalendarCheck}
                title="Everybody is in"
                message="No approved leave covers today."
              />
            )}
          </Card>

          {/* -------------------------------------- interviews coming up */}
          <Card>
            <CardHeader
              title="Interviews coming up"
              subtitle={
                interviews.length
                  ? `${interviews.length} scheduled, soonest first`
                  : "Scheduled rounds, soonest first"
              }
              action={<More to="/admin/hr/recruitment">Recruitment</More>}
            />
            {interviews.length ? (
              <ul className="divide-y divide-slate-100">
                {interviews.map((row, index) => (
                  <li
                    key={`${row.candidateId}-${row.round}-${index}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
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
                compact
                icon={UserPlus}
                title="Nothing scheduled"
                message="Rounds you schedule on a candidate show up here."
              />
            )}
          </Card>
        </div>

        {/* ------------------------------------- the two breakdowns */}
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Card>
            <CardHeader
              title="All employees by role"
              subtitle={`${roleTotal} on the payroll`}
              action={<More to="/admin/employees">Everybody</More>}
            />
            {roleRows.length ? (
              <ul className="pb-1.5">
                {roleRows.map(([role, count]) => (
                  <ShareRow
                    key={role}
                    label={role.replace(/_/g, " ")}
                    count={count}
                    total={roleTotal}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={UsersRound} title="Nobody on record yet" />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Hiring pipeline"
              subtitle={
                pipelineTotal
                  ? `${pipelineTotal} candidate${pipelineTotal === 1 ? "" : "s"} in play`
                  : "Candidates by stage"
              }
              action={<More to="/admin/hr/recruitment">Open</More>}
            />
            {pipeline.length ? (
              <ul className="pb-1.5">
                {pipeline.map(([stage, count]) => (
                  <li key={stage} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <Badge value={stage}>{stageLabel(stage)}</Badge>
                      <span className="shrink-0 text-sm font-semibold text-slate-900">{count}</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{
                          width: `${pipelineTotal ? Math.round((count / pipelineTotal) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={UserPlus}
                title="No candidates yet"
                message="Add one from Recruitment to start the pipeline."
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
