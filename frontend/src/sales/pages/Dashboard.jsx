import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Flame,
  Gauge,
  IndianRupee,
  PhoneCall,
  Target as TargetIcon,
  TrendingUp,
  Trophy,
  UsersRound,
  Wallet,
} from "lucide-react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

/**
 * The screen a sales person lands on.
 *
 * Deliberately opens with what is late rather than with what has been won.
 * A dashboard that leads with achievement is pleasant and useless; the first
 * thing somebody needs at 9am is the list of people they said they would ring
 * yesterday and did not.
 *
 * Every number is scoped by the server: an executive sees their own pipeline,
 * a head sees the floor's. The page does not decide that and does not need to
 * know which it is looking at — beyond the wording of one heading.
 *
 * Nothing here is invented. Every figure comes from /sales/dashboard, which
 * counts it from the leads, invoices, follow-ups and activity rows on read —
 * so a number on this page cannot drift from the list it links to.
 */

/* ------------------------------------------------------------- formatting */

const money = (n = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Lakhs and crores on the tiles, because a KPI is read at a glance and
 * "₹18,50,000" is read digit by digit. The exact figure stays in the tooltip
 * and on the screen the tile opens.
 */
const shortMoney = (n = 0) => {
  const amount = Number(n || 0);
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  if (amount >= 1000) return `₹${Math.round(amount / 1000)}k`;
  return `₹${amount}`;
};

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

/** Today shows a clock, yesterday says so, anything older gets a date. */
const whenLabel = (value) => {
  if (!value) return "—";
  const at = new Date(value);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday - new Date(at).setHours(0, 0, 0, 0)) / 86400000);

  if (days <= 0) return at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const dueLabel = (value) => {
  if (!value) return "No date";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(value).setHours(0, 0, 0, 0) - startOfToday) / 86400000);

  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)}d late`;
  return `in ${diff}d`;
};

/* ------------------------------------------------------------------ tones */

/** Red needs you now, amber is moving, blue is waiting, green is done. */
const TONES = {
  red: { icon: "bg-red-50 text-red-600", value: "text-red-600", dot: "bg-red-500", pill: "bg-red-50 text-red-700 ring-red-200" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-600", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-blue-600", dot: "bg-blue-500", pill: "bg-blue-50 text-blue-700 ring-blue-200" },
  green: { icon: "bg-green-50 text-green-600", value: "text-green-600", dot: "bg-green-500", pill: "bg-green-50 text-green-700 ring-green-200" },
  violet: { icon: "bg-violet-50 text-violet-600", value: "text-violet-600", dot: "bg-violet-500", pill: "bg-violet-50 text-violet-700 ring-violet-200" },
  slate: { icon: "bg-slate-100 text-slate-600", value: "text-slate-900", dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700 ring-slate-200" },
};

const STAGE_TONE = {
  new: "slate",
  contacted: "blue",
  qualified: "blue",
  quoted: "amber",
  negotiating: "amber",
  won: "green",
  lost: "red",
};

const ACTIVITY_TONE = { call: "blue", meeting: "violet", email: "slate", note: "slate" };

/** The stored values are snake_case; these are what a person reads. */
const WORK_LOCATION_LABELS = {
  office: "Office",
  field: "Field",
  hybrid: "Hybrid",
  remote: "Remote",
};

const prettify = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* ----------------------------------------------------------------- pieces */

/**
 * One KPI. Every tile opens the list it counted — a number somebody cannot
 * click through to is a number they have to go and find.
 */
function Kpi({ icon: Icon, label, value, sub, tone = "slate", to, title }) {
  const t = TONES[tone];

  return (
    <Link to={to} className="group block" title={title}>
      <Card className="p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.icon}`}>
            <Icon size={16} />
          </span>
          <ArrowRight
            size={14}
            className="text-slate-300 transition-colors group-hover:text-slate-500"
          />
        </div>
        <p className={`mt-3 text-2xl font-bold tracking-tight ${t.value}`}>{value}</p>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
          <p className="text-sm font-medium text-slate-600">{label}</p>
        </div>
        {/* Wraps rather than truncating — the line under a number is the half
            that says what the number means */}
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{sub}</p>
      </Card>
    </Link>
  );
}

/** A stage pill with a tone that matches how far along the deal is. */
function StagePill({ stage }) {
  const t = TONES[STAGE_TONE[stage] || "slate"];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t.pill}`}
    >
      {prettify(stage)}
    </span>
  );
}

/* ------------------------------------------------------------------- page */

export default function SalesDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  /**
   * What HR recorded about this job. Free — /sales/me is already fetched once
   * per page load for the permissions, and it answers with the account too.
   */
  const { account } = useSalesAccess();

  useEffect(() => {
    let active = true;
    salesApi
      .get("/sales/dashboard")
      .then(({ data: d }) => active && setData(d))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load the dashboard")
      );
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loader label="Loading your pipeline…" />;

  const team = data.scope === "team";
  const { thisMonth, pipeline, followUps } = data;

  // Older payloads carry none of these; each renders as an empty state
  const revenue = data.revenue || { billed: 0, received: 0, outstanding: 0 };
  const targets = data.targets || [];
  const trend = data.trend || [];
  const teamRows = data.team || [];
  const highValue = data.highValue || [];
  const activity = data.recentActivity || [];
  const awaiting = data.awaitingHandover || [];
  const attention = data.attention || {};

  const todaysFollowUps = (data.upcomingFollowUps || []).filter((f) => {
    if (!f.dueOn) return false;
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return new Date(f.dueOn) <= end;
  });

  /* ------------------------------------------- what is actually waiting */

  const actions = [
    followUps.overdue > 0 && {
      key: "overdue",
      tone: "red",
      label: `${followUps.overdue} overdue follow-${followUps.overdue === 1 ? "up" : "ups"}`,
      detail: "Past their day and nobody has closed them",
      action: "Call now",
      to: "/sales/followups?view=overdue",
    },
    attention.staleLeads > 0 && {
      key: "stale",
      tone: "amber",
      label: `${attention.staleLeads} ${attention.staleLeads === 1 ? "deal has" : "deals have"} gone quiet`,
      detail: "Open, and untouched for over a fortnight",
      action: "Review",
      to: "/sales/pipeline",
    },
    data.clientsAwaitingHandover > 0 && {
      key: "handover",
      tone: "blue",
      label: `${data.clientsAwaitingHandover} won ${
        data.clientsAwaitingHandover === 1 ? "client is" : "clients are"
      } waiting on Operations`,
      detail: "Won, and not yet handed over to delivery",
      action: "Hand over",
      to: "/sales/clients?handover=pending",
    },
  ].filter(Boolean);

  const peak = Math.max(1, ...trend.map((m) => Math.max(m.created, m.won)));

  return (
    <div className="space-y-4">
      <PageHeader
        title={team ? "Sales overview" : "My pipeline"}
        subtitle={
          team ? "The whole floor, this month" : "The leads assigned to you, and what you owe them"
        }
      />

      {/**
       * What this person was actually taken on to do.
       *
       * A dashboard that opens with numbers and never says whose numbers they
       * are is the same screen for a field sales manager running six people
       * and an inside-sales executive running none. This is one line, so it
       * costs the numbers nothing, and it is only drawn when HR recorded
       * something to draw.
       */}
      {account &&
        (account.salesRole || account.teamSize > 0 || (account.responsibilities || []).length > 0) && (
          <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <span className="text-sm font-medium text-slate-800">
              {account.salesRole || account.designation || "Sales"}
            </span>

            {(account.workLocation || account.teamSize > 0) && (
              <span className="text-xs text-slate-500">
                {[
                  WORK_LOCATION_LABELS[account.workLocation],
                  account.teamSize ? `${account.teamSize} in the team` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}

            {(account.responsibilities || []).length > 0 && (
              <span className="ml-auto flex flex-wrap justify-end gap-1">
                {account.responsibilities.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                  >
                    {item}
                  </span>
                ))}
              </span>
            )}
          </Card>
        )}

      {/* ------------------------------------------------------ the KPI row */}
      {/**
       * Four across, in two rows.
       *
       * Eight in a single row left each tile about 130px wide, which truncated
       * every label on it — "Open pipe…", "Won this …", "Nothing outstan…". A
       * KPI nobody can read is not a KPI. Two rows of four give each one room
       * for its number, its name and the line under it, and the top row is the
       * money while the bottom row is the work.
       */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Wallet}
          label="Received"
          value={shortMoney(revenue.received)}
          sub={revenue.outstanding ? `${shortMoney(revenue.outstanding)} outstanding` : "Nothing outstanding"}
          tone="green"
          to="/sales/revenue"
          title={`${money(revenue.received)} received of ${money(revenue.billed)} billed`}
        />
        <Kpi
          icon={IndianRupee}
          label="Billed"
          value={shortMoney(revenue.billed)}
          sub="Invoiced this month"
          tone="violet"
          to="/sales/revenue"
          title={money(revenue.billed)}
        />
        <Kpi
          icon={TrendingUp}
          label="Open pipeline"
          value={shortMoney(pipeline.open.value)}
          sub={`${pipeline.open.count} live ${pipeline.open.count === 1 ? "deal" : "deals"}`}
          tone="blue"
          to="/sales/pipeline"
          title={money(pipeline.open.value)}
        />
        <Kpi
          icon={Trophy}
          label="Won this month"
          value={shortMoney(thisMonth.wonValue)}
          sub={`${thisMonth.won} ${thisMonth.won === 1 ? "deal" : "deals"} closed`}
          tone="green"
          to="/sales/leads?stage=won"
          title={money(thisMonth.wonValue)}
        />
        <Kpi
          icon={TargetIcon}
          label="New leads"
          value={thisMonth.newLeads}
          sub="Added this month"
          tone="blue"
          to="/sales/leads"
        />
        <Kpi
          icon={Gauge}
          label="Conversion"
          value={`${thisMonth.conversionRate}%`}
          sub={`of ${thisMonth.won + thisMonth.lost} decided`}
          tone={thisMonth.conversionRate >= 50 ? "green" : "amber"}
          to="/sales/reports"
        />
        <Kpi
          icon={PhoneCall}
          label="Due today"
          value={followUps.dueToday}
          sub={followUps.dueToday ? "Follow-ups to make" : "Nothing booked"}
          tone={followUps.dueToday ? "amber" : "slate"}
          to="/sales/followups?view=today"
        />
        <Kpi
          icon={AlertTriangle}
          label="Overdue"
          value={followUps.overdue}
          sub={followUps.overdue ? "Already late" : "Nothing is late"}
          tone={followUps.overdue ? "red" : "green"}
          to="/sales/followups?view=overdue"
        />
      </div>

      {/* ------------------------------------------------- action required */}
      <Card>
        <CardHeader
          title="Action required"
          subtitle="Things that will not move unless somebody moves them"
        />
        {actions.length ? (
          <div className="divide-y divide-slate-100">
            {actions.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[item.tone].dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{item.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset ${TONES[item.tone].pill}`}
                >
                  {item.action}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing is waiting on you"
            message="No overdue calls, no deals gone quiet and nothing stuck before delivery."
          />
        )}
      </Card>

      {/* ---------------------------- sales performance + target vs actual */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Sales performance"
            subtitle="Leads added against deals won, last six months"
            action={
              <Link to="/sales/reports" className="text-xs font-medium text-blue-600 hover:underline">
                Full report
              </Link>
            }
          />
          {trend.length ? (
            <>
              <div className="flex items-end gap-2 overflow-x-auto px-5 pt-5 pb-3">
                {trend.map((month) => (
                  <div key={month.month} className="flex min-w-12 flex-1 flex-col items-center">
                    <div className="flex h-28 w-full items-end justify-center gap-1">
                      <div
                        className="w-1/3 rounded-t bg-blue-500"
                        style={{ height: `${Math.max(3, (month.created / peak) * 100)}%` }}
                        title={`${month.created} leads added`}
                      />
                      <div
                        className="w-1/3 rounded-t bg-green-500"
                        style={{ height: `${Math.max(3, (month.won / peak) * 100)}%` }}
                        title={`${month.won} deals won · ${money(month.wonValue)}`}
                      />
                    </div>
                    <span className="mt-1.5 text-[11px] text-slate-400">{month.month}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Leads added
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> Deals won
                </span>
              </div>
            </>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No history yet"
              message="Once leads start being added, six months of them show up here."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Target vs achievement"
            subtitle="This month, counted from the CRM"
          />
          {targets.length ? (
            <div className="divide-y divide-slate-100">
              {targets.map((target) => {
                const percent = target.percent ?? 0;
                const done = percent >= 100;
                return (
                  <div key={target._id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{target.label}</p>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          done ? "text-green-600" : percent >= 60 ? "text-amber-600" : "text-red-600"
                        }`}
                      >
                        {percent}%
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={Math.min(100, percent)} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {target.unit === "currency"
                        ? `${money(target.actual)} of ${money(target.targetValue)}`
                        : `${target.actual} of ${target.targetValue}`}
                      {target.scope === "team" ? ` · ${target.teamName || "team"}` : " · yours"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={TargetIcon}
              title="No target set for this month"
              message="Once a target is agreed, progress against it is counted here automatically."
            />
          )}
        </Card>
      </div>

      {/* ---------------------------------- pipeline + today's follow-ups */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Deal pipeline"
            subtitle="Where the open deals are sitting"
            action={
              <Link to="/sales/pipeline" className="text-xs font-medium text-blue-600 hover:underline">
                Open the board
              </Link>
            }
          />
          {pipeline.open.count ? (
            <div className="divide-y divide-slate-100">
              {pipeline.stages
                .filter((s) => !["won", "lost"].includes(s.stage))
                .map((stage) => {
                  const share = pipeline.open.value
                    ? Math.round((stage.value / pipeline.open.value) * 100)
                    : 0;
                  return (
                    <Link
                      key={stage.stage}
                      to={`/sales/pipeline?stage=${stage.stage}`}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50"
                    >
                      <StagePill stage={stage.stage} />
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${TONES[STAGE_TONE[stage.stage] || "slate"].dot}`}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {stage.count}
                      </span>
                      <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700">
                        {money(stage.value)}
                      </span>
                    </Link>
                  );
                })}
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No open deals"
              message="Leads you add appear here as they move through the stages."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Today's follow-ups"
            subtitle="Due today, and anything still late"
            action={
              <Link to="/sales/followups" className="text-xs font-medium text-blue-600 hover:underline">
                All
              </Link>
            }
          />
          {todaysFollowUps.length ? (
            <div className="divide-y divide-slate-100">
              {todaysFollowUps.map((item) => {
                const late = new Date(item.dueOn) < new Date().setHours(0, 0, 0, 0);
                return (
                  <Link
                    key={item._id}
                    to="/sales/followups"
                    className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        late ? TONES.red.dot : TONES.amber.dot
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.title || "Follow-up"}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {item.lead?.company || item.lead?.name || item.client?.company || item.client?.name || "No contact"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-medium ${
                        late ? "text-red-600" : "text-slate-500"
                      }`}
                    >
                      {dueLabel(item.dueOn)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="Nothing scheduled"
              message="Worth booking some — a pipeline with no next call goes quiet."
            />
          )}
        </Card>
      </div>

      {/* ------------------------------- high-value deals + latest leads */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="High-value deals"
            subtitle="The biggest open deals — where an hour pays best"
            action={
              <Link to="/sales/pipeline" className="text-xs font-medium text-blue-600 hover:underline">
                Pipeline
              </Link>
            }
          />
          {highValue.length ? (
            <div className="divide-y divide-slate-100">
              {highValue.map((lead) => (
                <Link
                  key={lead._id}
                  to="/sales/pipeline"
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <Flame size={15} className="shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {lead.company || lead.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {lead.name}
                      {lead.owner?.name ? ` · ${lead.owner.name}` : ""}
                    </p>
                  </div>
                  <StagePill stage={lead.stage} />
                  <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">
                    {money(lead.estimatedValue)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Flame}
              title="No open deals yet"
              message="Deals with a value on them are ranked here, biggest first."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest leads"
            subtitle="Most recently added"
            action={
              <Link to="/sales/leads" className="text-xs font-medium text-blue-600 hover:underline">
                All leads
              </Link>
            }
          />
          {(data.recentLeads || []).length ? (
            <div className="divide-y divide-slate-100">
              {data.recentLeads.map((lead) => (
                <Link
                  key={lead._id}
                  to="/sales/leads"
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {lead.company || lead.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {prettify(lead.source || "")} · {shortDate(lead.createdAt)}
                      {lead.owner?.name ? ` · ${lead.owner.name}` : ""}
                    </p>
                  </div>
                  <StagePill stage={lead.stage} />
                  <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600">
                    {lead.estimatedValue ? money(lead.estimatedValue) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={TargetIcon}
              title="No leads yet"
              message="Everything you add shows up here, newest first."
            />
          )}
        </Card>
      </div>

      {/* ------------------------- team performance + activity + handover */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={team ? "Team performance" : "My performance"}
            subtitle="Leads carried, deals won and what is still open"
            action={
              <Link to="/sales/reports" className="text-xs font-medium text-blue-600 hover:underline">
                Reports
              </Link>
            }
          />
          {teamRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-400 uppercase">
                    <th className="px-5 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 text-right font-medium">Leads</th>
                    <th className="px-3 py-2 text-right font-medium">Won</th>
                    <th className="px-3 py-2 text-right font-medium">Conv.</th>
                    <th className="px-3 py-2 text-right font-medium">Won value</th>
                    <th className="px-5 py-2 text-right font-medium">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamRows.map((person) => (
                    <tr key={person._id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <p className="truncate font-medium text-slate-800">{person.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {prettify(person.role || "")}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {person.leads}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {person.won}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`text-xs font-semibold ${
                            person.conversionRate >= 50
                              ? "text-green-600"
                              : person.conversionRate > 0
                                ? "text-amber-600"
                                : "text-slate-400"
                          }`}
                        >
                          {person.conversionRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-800">
                        {money(person.wonValue)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-500">
                        {money(person.openValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={UsersRound}
              title="Nothing to compare yet"
              message="Once leads are owned by somebody, their numbers appear here."
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Calls, meetings and notes logged" />
          {activity.length ? (
            <div className="divide-y divide-slate-100">
              {activity.map((row) => (
                <div key={row._id} className="flex gap-3 px-5 py-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      (TONES[ACTIVITY_TONE[row.type]] || TONES.slate).dot
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-slate-700">
                      <span className="font-medium text-slate-900">{row.byName || "Someone"}</span>{" "}
                      logged a {row.type}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {row.subject || prettify(row.outcome || "")}
                      {row.lead?.company ? ` · ${row.lead.company}` : ""}
                      {row.client?.company ? ` · ${row.client.company}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {whenLabel(row.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={PhoneCall}
              title="Nothing logged yet"
              message="Calls and meetings recorded against a lead show up here."
            />
          )}
        </Card>
      </div>

      {/* ------------------------------------ pending operations handover */}
      <Card>
        <CardHeader
          title="Pending operations handover"
          subtitle="Won clients that delivery has not been given yet"
          action={
            <Link to="/sales/clients" className="text-xs font-medium text-blue-600 hover:underline">
              All clients
            </Link>
          }
        />
        {awaiting.length ? (
          <div className="divide-y divide-slate-100">
            {awaiting.map((client) => (
              <Link
                key={client._id}
                to="/sales/clients?handover=pending"
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
              >
                <Building2 size={15} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {client.company || client.name}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">
                    {client.company ? client.name : "Won"} · last touched {whenLabel(client.updatedAt)}
                  </p>
                </div>
                <Badge value={client.status} />
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset ${TONES.blue.pill}`}
                >
                  Hand over
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Everything has been handed over"
            message="No won client is waiting on Operations."
          />
        )}
      </Card>
    </div>
  );
}
