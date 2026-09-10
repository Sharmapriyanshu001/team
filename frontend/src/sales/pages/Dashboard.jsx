import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, IndianRupee, Target, TrendingUp } from "lucide-react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import { Alert, Badge, Card, CardHeader, Loader, PageHeader } from "../../shared/components/ui";

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
 */

const money = (n = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

/** The stored values are snake_case; these are what a person reads. */
const WORK_LOCATION_LABELS = {
  office: "Office",
  field: "Field",
  hybrid: "Hybrid",
  remote: "Remote",
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
      .catch((err) => active && setError(err.response?.data?.message || "Could not load the dashboard"));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loader label="Loading your pipeline…" />;

  const team = data.scope === "team";
  const { thisMonth, pipeline, followUps } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={team ? "Sales overview" : "My pipeline"}
        subtitle={
          team
            ? "The whole floor, this month"
            : "The leads assigned to you, and what you owe them"
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
      {account && (account.salesRole || account.teamSize > 0 || (account.responsibilities || []).length > 0) && (
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

      {/* What is late comes first, and only when there is any. */}
      {(followUps.overdue > 0 || followUps.dueToday > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {followUps.overdue > 0 && (
            <Link to="/sales/followups?view=overdue">
              <Card className="border-red-200 bg-red-50 p-4 transition-colors hover:bg-red-100">
                <p className="flex items-center gap-2 text-xs font-medium text-red-700">
                  <AlertTriangle size={14} /> Overdue follow-ups
                </p>
                <p className="mt-1 text-2xl font-semibold text-red-800">{followUps.overdue}</p>
                <p className="text-xs text-red-600">Past their day and still open</p>
              </Card>
            </Link>
          )}
          {followUps.dueToday > 0 && (
            <Link to="/sales/followups?view=today">
              <Card className="border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100">
                <p className="flex items-center gap-2 text-xs font-medium text-blue-700">
                  <CalendarClock size={14} /> Due today
                </p>
                <p className="mt-1 text-2xl font-semibold text-blue-800">{followUps.dueToday}</p>
                <p className="text-xs text-blue-600">Ring them before the day goes</p>
              </Card>
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Open pipeline", value: money(pipeline.open.value), sub: `${pipeline.open.count} live deals`, icon: TrendingUp },
          { label: "Won this month", value: money(thisMonth.wonValue), sub: `${thisMonth.won} deal${thisMonth.won === 1 ? "" : "s"}`, icon: IndianRupee },
          { label: "New leads", value: thisMonth.newLeads, sub: "this month", icon: Target },
          { label: "Conversion", value: `${thisMonth.conversionRate}%`, sub: `of ${thisMonth.won + thisMonth.lost} decided`, icon: TrendingUp },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <s.icon size={13} /> {s.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
            <p className="text-xs text-slate-500">{s.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="The pipeline"
            subtitle="Where the open deals are sitting"
            action={
              <Link to="/sales/pipeline" className="text-xs font-medium text-blue-600 hover:underline">
                Open the board
              </Link>
            }
          />
          <div className="space-y-2 p-4 pt-0">
            {pipeline.stages
              .filter((s) => !["won", "lost"].includes(s.stage))
              .map((s) => (
                <div key={s.stage} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Badge value={s.stage} tone={STAGE_TONE[s.stage]} />
                  </span>
                  <span className="text-slate-500">
                    {s.count} · <span className="font-medium text-slate-900">{money(s.value)}</span>
                  </span>
                </div>
              ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Next up" subtitle="The follow-ups closest to their day" />
          <div className="divide-y divide-slate-100">
            {(data.upcomingFollowUps || []).length === 0 && (
              <p className="p-4 text-sm text-slate-500">Nothing scheduled. Worth booking some.</p>
            )}
            {(data.upcomingFollowUps || []).map((f) => (
              <div key={f._id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{f.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {f.lead?.name || f.client?.name || "—"}
                    {f.lead?.company ? ` · ${f.lead.company}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{shortDate(f.dueOn)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Latest leads"
          action={
            <Link to="/sales/leads" className="text-xs font-medium text-blue-600 hover:underline">
              All leads
            </Link>
          }
        />
        <div className="divide-y divide-slate-100">
          {(data.recentLeads || []).length === 0 && (
            <p className="p-4 text-sm text-slate-500">No leads yet.</p>
          )}
          {(data.recentLeads || []).map((l) => (
            <div key={l._id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{l.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {l.company || "—"} · {String(l.source || "").replace(/_/g, " ")}
                  {team && l.owner?.name ? ` · ${l.owner.name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate-500">{money(l.estimatedValue)}</span>
                <Badge value={l.stage} tone={STAGE_TONE[l.stage]} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {data.clientsAwaitingHandover > 0 && (
        <Alert tone="success">
          {data.clientsAwaitingHandover} won client
          {data.clientsAwaitingHandover === 1 ? " is" : "s are"} still waiting to be handed to
          Operations —{" "}
          <Link to="/sales/clients?handover=pending" className="font-medium underline">
            hand them over
          </Link>
        </Alert>
      )}
    </div>
  );
}
