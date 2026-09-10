import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CalendarClock,
  Clock,
  UserCheck,
} from "lucide-react";

import hrApi from "../../hrApi";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
} from "../../../shared/components/ui";
import {
  CANDIDATE_STAGES,
  monthOptions,
  shortDate,
  sourceLabel,
  stageLabel,
  yearOptions,
} from "../../../shared/hr/constants";

/**
 * How hiring is going.
 *
 * The funnel is the point of the screen, and it is drawn against the openings
 * rather than on its own — three candidates is good news for one vacancy and
 * bad news for five, and a pipeline with no vacancy behind it cannot be read
 * either way.
 *
 * Every figure comes from /hr/hiring/dashboard, counted from the records on
 * read. Nothing here is stored, so none of it can go stale.
 */

const FUNNEL_TONE = {
  applied: "bg-slate-400",
  screening: "bg-sky-400",
  interview: "bg-violet-400",
  shortlisted: "bg-blue-500",
  selected: "bg-amber-400",
  hired: "bg-emerald-500",
};

const Stat = ({ icon: Icon, label, value, hint, tone = "blue", to }) => {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    red: "bg-red-50 text-red-600",
  };

  const body = (
    <div className="flex items-start gap-3 p-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
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

export default function HiringDashboard() {
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
      .get("/hr/hiring/dashboard", { params: period })
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load the board")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [period]);

  if (loading && !data) return <Loader label="Loading hiring…" />;

  const stats = data?.stats || {};
  const funnel = data?.funnel || {};

  // The funnel bars are drawn relative to the widest stage, so a pipeline of
  // three still reads as a shape rather than as four invisible slivers
  const funnelStages = CANDIDATE_STAGES.filter((s) => s.value !== "rejected");
  const widest = Math.max(1, ...funnelStages.map((s) => funnel[s.value] || 0));

  return (
    <div>
      <PageHeader
        title="Hiring Dashboard"
        subtitle="Openings, the pipeline against them, and where the hires come from"
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
          icon={Briefcase}
          label="Open roles"
          value={stats.liveOpenings ?? 0}
          hint={`${stats.seatsOpen ?? 0} seat${stats.seatsOpen === 1 ? "" : "s"} to fill`}
          to="/hr/hiring/openings"
        />
        <Stat
          icon={Clock}
          label="In the pipeline"
          value={data?.inPlay ?? 0}
          hint={`${stats.addedThisMonth ?? 0} added this month`}
          tone="violet"
          to="/hr/hiring/candidates"
        />
        <Stat
          icon={CalendarClock}
          label="Interviews coming up"
          value={stats.interviewsUpcoming ?? 0}
          hint="Scheduled from today"
          tone="amber"
          to="/hr/hiring/interviews"
        />
        <Stat
          icon={UserCheck}
          label="Hired this month"
          value={stats.hiredThisMonth ?? 0}
          hint={
            stats.medianDaysToHire === null || stats.medianDaysToHire === undefined
              ? "No hires to measure yet"
              : `${stats.medianDaysToHire} days, typically`
          }
          tone="emerald"
          to="/hr/hiring/onboarding"
        />
      </div>

      {stats.overdueOpenings > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {stats.overdueOpenings} opening{stats.overdueOpenings === 1 ? " is" : "s are"} past their
          target date and still unfilled.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------------ the funnel */}
        <Card>
          <CardHeader
            title="The funnel"
            subtitle="Everybody on record, by where they stand"
            action={
              <Link
                to="/hr/hiring/candidates"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Candidates <ArrowRight size={13} />
              </Link>
            }
          />
          <div className="space-y-2.5 p-4">
            {funnelStages.map((stage) => {
              const count = funnel[stage.value] || 0;
              return (
                <div key={stage.value}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{stage.label}</span>
                    <span className="text-slate-500">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${FUNNEL_TONE[stage.value] || "bg-slate-400"}`}
                      style={{ width: `${Math.round((count / widest) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
              <span className="text-slate-500">Not taken forward</span>
              <span className="font-medium text-slate-700">{funnel.rejected || 0}</span>
            </div>
          </div>
        </Card>

        {/* ----------------------------------------------------- the openings */}
        <Card>
          <CardHeader
            title="Open roles"
            subtitle="How each vacancy is filling"
            action={
              <Link
                to="/hr/hiring/openings"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                All openings <ArrowRight size={13} />
              </Link>
            }
          />
          {data?.openings?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.openings.slice(0, 6).map((opening) => (
                <li key={opening._id} className="px-4 py-3">
                  <Link to={`/hr/hiring/openings/${opening._id}`} className="block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {opening.title}
                          {opening.overdue && (
                            <span className="ml-2 text-[11px] font-normal text-amber-600">
                              overdue
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {opening.code}
                          {opening.department ? ` · ${opening.department}` : ""} ·{" "}
                          {opening.inPlay} in play
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-slate-500">
                          {opening.hired}/{opening.positions}
                        </span>
                        <ProgressBar
                          value={Math.round((opening.hired / (opening.positions || 1)) * 100)}
                        />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No open roles"
              message="Add a job opening to start a pipeline against it."
            />
          )}
        </Card>

        {/* ------------------------------------------------- what is scheduled */}
        <Card>
          <CardHeader title="Interviews coming up" subtitle="Soonest first" />
          {data?.upcoming?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.upcoming.map((row, index) => (
                <li
                  key={`${row.candidateId}-${row.round}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{row.candidate}</p>
                    <p className="truncate text-xs text-slate-400">
                      {row.round}
                      {row.opening ? ` · ${row.opening}` : ""}
                      {row.interviewerName ? ` · ${row.interviewerName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {shortDate(row.scheduledAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="Nothing scheduled"
              message="Rounds you schedule on a candidate show up here."
            />
          )}
        </Card>

        {/* ------------------------------------------------------ the sources */}
        <Card>
          <CardHeader
            title="Where hires come from"
            subtitle="Candidates by source, and how many of each joined"
          />
          {data?.sources?.length ? (
            <ul className="divide-y divide-slate-100">
              {data.sources.map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-slate-700">{sourceLabel(row.source)}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-400">
                      {row.hired} of {row.total}
                    </span>
                    <Badge tone={row.rate >= 20 ? "blue" : "slate"}>{row.rate}%</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserCheck}
              title="No candidates yet"
              message="Source effectiveness needs candidates to measure."
            />
          )}
        </Card>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        The flow: a job opening takes candidates, candidates sit interviews, the ones worth taking
        forward are shortlisted then selected, and onboarding turns a selected candidate into an
        employee with a login. Every stage below shows the same records from a different angle.
      </p>

      {/* A quiet legend, so the stage names on the other screens mean something */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CANDIDATE_STAGES.map((stage) => (
          <Badge key={stage.value} value={stage.value}>
            {stageLabel(stage.value)}
          </Badge>
        ))}
      </div>
    </div>
  );
}
