import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  Gauge,
  ListChecks,
  MessageSquareWarning,
  UserPlus,
  UsersRound,
} from "lucide-react";

import leaderApi from "../leaderApi";
import { prettify } from "../../shared/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

/**
 * The manager's dashboard answers a different question from the employee's.
 *
 * An employee opens theirs to ask "what do I do next"; a manager opens this to
 * ask "what is my team doing, and what is waiting on me". Everything here is
 * therefore about other people and about decisions only this account can make
 * — which is why nothing on it is a personal task list.
 *
 * The six-month delivery chart that used to sit here has moved to Reports. A
 * trend is something you go and look at; a dashboard is something you glance
 * at, and this week is the unit a manager actually runs.
 */

/** Red needs you now, amber is moving, blue is waiting on somebody else. */
const TONES = {
  red: {
    icon: "bg-red-50 text-red-600",
    value: "text-red-600",
    dot: "bg-red-500",
    pill: "bg-red-50 text-red-700 ring-red-200",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600",
    value: "text-amber-600",
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  blue: {
    icon: "bg-blue-50 text-blue-600",
    value: "text-blue-600",
    dot: "bg-blue-500",
    pill: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  green: {
    icon: "bg-green-50 text-green-600",
    value: "text-green-600",
    dot: "bg-green-500",
    pill: "bg-green-50 text-green-700 ring-green-200",
  },
  slate: {
    icon: "bg-slate-100 text-slate-600",
    value: "text-slate-900",
    dot: "bg-slate-400",
    pill: "bg-slate-100 text-slate-700 ring-slate-200",
  },
};

const STATE_TONE = { overdue: "red", attention: "amber", on_track: "green" };
const STATE_LABEL = { overdue: "Overdue", attention: "Needs you", on_track: "On track" };
const ACTIVITY_TONE = { completed: "green", review: "amber", blocker: "red" };
const SEVERITY_TONE = { critical: "red", high: "red", medium: "amber", low: "slate" };

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const dayLabel = (value) => {
  if (!value) return "No date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(value).setHours(0, 0, 0, 0) - today) / 86400000);

  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `in ${diff}d`;
};

/** Today shows a clock, yesterday says so, anything older gets a date. */
const whenLabel = (value) => {
  const at = new Date(value);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday - new Date(at).setHours(0, 0, 0, 0)) / 86400000);

  if (days <= 0) return at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/* ------------------------------------------------------------------ pieces */

/** A count that is also a door: every card opens the list it counted. */
function StatCard({ icon: Icon, label, value, sub, tone, to }) {
  const t = TONES[tone];

  return (
    <Link to={to} className="group block">
      <Card className="p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.icon}`}>
            <Icon size={18} />
          </span>
          <ArrowRight
            size={15}
            className="text-slate-300 transition-colors group-hover:text-slate-500"
          />
        </div>
        <p className={`mt-4 text-2xl font-bold tracking-tight ${t.value}`}>{value}</p>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
          <p className="text-sm font-medium text-slate-600">{label}</p>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">{sub}</p>
      </Card>
    </Link>
  );
}

/**
 * One thing waiting on the manager, with the button that deals with it.
 *
 * Rendered only when the count is non-zero — a list of four zeroes is a list
 * that trains somebody to stop reading it.
 */
function AttentionRow({ tone, label, detail, action, to }) {
  const navigate = useNavigate();
  const t = TONES[tone];

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{label}</p>
        <p className="truncate text-[11px] text-slate-400">{detail}</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigate(to)}>
        {action}
      </Button>
    </div>
  );
}

/** One figure in the week strip. */
function WeekStat({ label, value, tone, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONES[tone].dot}`} />
        <p className="truncate text-[11px] font-medium text-slate-500">{label}</p>
      </div>
      <p className={`mt-1 text-xl font-bold tracking-tight ${TONES[tone].value}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export default function Dashboard() {
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/dashboard")
      .then(({ data: res }) => active && setData(res))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your dashboard");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader label="Loading your dashboard..." />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { stats, recent } = data;

  // Older payloads carry none of these; every one renders as an empty state
  const week = data.week || {};
  const team = data.team || { on_track: 0, attention: 0, overdue: 0, members: [] };
  const issues = data.issues || {};
  const projectRows = data.projectRows || [];
  const activity = recent.activity || [];

  /* ----------------------------------------------- what is waiting on me */

  const attention = [
    stats.overdueTasks > 0 && {
      key: "overdue",
      tone: "red",
      label: `${stats.overdueTasks} overdue ${stats.overdueTasks === 1 ? "task" : "tasks"}`,
      detail: "Past their due date and still open",
      action: "View",
      to: "/operation-manager/tasks/pending",
    },
    stats.tasksInReview > 0 && {
      key: "review",
      tone: "amber",
      label: `${stats.tasksInReview} waiting for your review`,
      detail: "Submitted work — sign it off or send it back",
      action: "Review",
      to: "/operation-manager/daily-review",
    },
    stats.openIssues > 0 && {
      key: "issues",
      tone: "red",
      label: `${stats.openIssues} open ${stats.openIssues === 1 ? "blocker" : "blockers"}`,
      detail: issues.latest?.title || "Raised by your team",
      action: "Resolve",
      to: "/operation-manager/issues",
    },
    stats.changeRequests > 0 && {
      key: "changes",
      tone: "blue",
      label: `${stats.changeRequests} client ${stats.changeRequests === 1 ? "change" : "changes"} to decide`,
      detail: "Requested on your projects",
      action: "Assign",
      to: "/operation-manager/change-requests",
    },
    stats.codeReviews > 0 && {
      key: "code",
      tone: "blue",
      label: `${stats.codeReviews} code ${stats.codeReviews === 1 ? "submission" : "submissions"} to review`,
      detail: "Sent to you by your team",
      action: "Review",
      to: "/operation-manager/code-reviews",
    },
  ].filter(Boolean);

  const QUICK_ACTIONS = [
    { label: "Assign Task", icon: ListChecks, to: "/operation-manager/tasks/create" },
    { label: "Assign Work", icon: UserPlus, to: "/operation-manager/assign-work" },
    { label: "Manage Team", icon: UsersRound, to: "/operation-manager/team" },
    { label: "Review Work", icon: ClipboardCheck, to: "/operation-manager/daily-review" },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Manage your team, projects and work that needs your attention."
      />

      {/* -------------------------------------------------- quick actions */}
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2 p-3">
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.to}
              size="sm"
              variant="outline"
              onClick={() => navigate(action.to)}
            >
              <action.icon size={14} />
              {action.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* ----------------------------------------------------- top summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={UsersRound}
          label="Team members"
          value={stats.teamSize}
          sub={
            stats.teamSize
              ? `${team.overdue} behind · ${team.attention} need you`
              : "Nobody assigned to you yet"
          }
          tone="blue"
          to="/operation-manager/team"
        />
        <StatCard
          icon={ListChecks}
          label="Open tasks"
          value={stats.tasksPending}
          sub={
            stats.tasksPending
              ? `${stats.dueToday ?? 0} due today · ${stats.overdueTasks} overdue`
              : "Nothing open right now"
          }
          tone="amber"
          to="/operation-manager/tasks/pending"
        />
        <StatCard
          icon={ClipboardCheck}
          label="Waiting for review"
          value={stats.tasksInReview}
          sub={stats.tasksInReview ? "Needs your sign-off" : "Nothing waiting on you"}
          tone="blue"
          to="/operation-manager/daily-review"
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue tasks"
          value={stats.overdueTasks}
          sub={stats.overdueTasks ? "Already past the deadline" : "Nothing is late"}
          tone={stats.overdueTasks ? "red" : "green"}
          to="/operation-manager/tasks/pending"
        />
      </div>

      {/* ------------------------------------------- needs your attention */}
      <Card className="mt-4">
        <CardHeader
          title="Needs your attention"
          subtitle="Decisions and hold-ups that are waiting on you specifically"
        />
        {attention.length ? (
          <div className="divide-y divide-slate-100">
            {attention.map((item) => (
              <AttentionRow key={item.key} {...item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing is waiting on you"
            message="No overdue work, nothing to review and no open blockers. Your team is clear."
          />
        )}
      </Card>

      {/* ------------------------------------ team overview + this week */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Team overview"
            subtitle="Amber means something of theirs is sitting with you"
            action={
              <Link
                to="/operation-manager/team"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View team
              </Link>
            }
          />

          {team.members.length ? (
            <>
              <div className="grid grid-cols-3 gap-2 px-5 py-3">
                {["on_track", "attention", "overdue"].map((state) => (
                  <div key={state} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONES[STATE_TONE[state]].dot}`}
                      />
                      <p className="truncate text-[11px] font-medium text-slate-500">
                        {STATE_LABEL[state]}
                      </p>
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold tracking-tight ${TONES[STATE_TONE[state]].value}`}
                    >
                      {team[state]}
                    </p>
                  </div>
                ))}
              </div>

              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {team.members.slice(0, 6).map((person) => (
                  <div key={person._id} className="flex items-center gap-3 px-5 py-2.5">
                    <span
                      className={`inline-flex w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                        TONES[STATE_TONE[person.state]].pill
                      }`}
                    >
                      {STATE_LABEL[person.state]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{person.name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {person.designation || "No designation"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {person.pending} open
                      {person.overdue ? ` · ${person.overdue} late` : ""}
                      {person.inReview ? ` · ${person.inReview} to review` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={UsersRound}
              title="No team members assigned yet"
              message="Once people report to you, how each of them is doing shows up here."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="This week"
            subtitle={week.from ? `Since ${fmt(week.from)}` : "Your team's week so far"}
            action={
              <Link
                to="/operation-manager/reports"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Reports
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-2 p-4">
            <WeekStat label="Completed" value={week.completed ?? 0} tone="green" />
            <WeekStat label="In progress" value={week.inProgress ?? 0} tone="amber" />
            <WeekStat label="Overdue" value={week.overdue ?? 0} tone="red" />
            {/**
             * Null rather than zero when nothing finished carried a deadline.
             * A team with no due dates reporting 100% on-time would be the one
             * number here somebody might actually act on.
             */}
            <WeekStat
              label="On time"
              value={week.onTimeRate === null || week.onTimeRate === undefined ? "—" : `${week.onTimeRate}%`}
              tone="blue"
              hint={week.measuredAgainst ? `of ${week.measuredAgainst} with a due date` : "none had a due date"}
            />
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------ project progress */}
      <Card className="mt-4">
        <CardHeader
          title="Project progress"
          subtitle="Where each active project stands — most at risk first"
          action={
            <Link
              to="/operation-manager/progress"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Progress board
            </Link>
          }
        />
        {projectRows.length ? (
          <div className="divide-y divide-slate-100">
            {projectRows.map((project) => (
              <Link
                key={project._id}
                to={`/operation-manager/projects/details?id=${project._id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-slate-50"
              >
                <div className="min-w-[8rem] flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {project.client || "No client"}
                    {project.endDate ? ` · due ${fmt(project.endDate)}` : ""}
                  </p>
                </div>

                <div className="w-32 shrink-0">
                  <ProgressBar value={project.progress} />
                </div>

                <span className="shrink-0 text-[11px] text-slate-500">
                  {project.completed} / {project.total} tasks
                </span>

                {project.overdue > 0 && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES.red.pill}`}
                  >
                    {project.overdue} late
                  </span>
                )}

                <Badge value={project.status} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No active projects"
            message="Projects you run appear here with their board underneath them."
          />
        )}
      </Card>

      {/* --------------------------------- team activity + review queue */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent team activity" subtitle="What your people have been doing" />
          {activity.length ? (
            <div className="divide-y divide-slate-100">
              {activity.map((row) => (
                <Link key={row.id} to={row.link} className="flex gap-3 px-5 py-2.5 hover:bg-slate-50">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      (TONES[ACTIVITY_TONE[row.kind]] || TONES.slate).dot
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-slate-700">
                      <span className="font-medium text-slate-900">{row.who}</span> {row.text}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{row.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{whenLabel(row.at)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Nothing yet"
              message="Completed work, submissions and blockers from your team show up here."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Waiting for your review"
            action={
              <Link
                to="/operation-manager/daily-review"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Review
              </Link>
            }
          />
          {recent.pendingReviews.length ? (
            <div className="divide-y divide-slate-100">
              {recent.pendingReviews.map((task) => (
                <div key={task._id} className="px-5 py-3">
                  <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {task.assignedTo?.name || "Unassigned"} · {task.project?.name || "No project"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ClipboardCheck}
              title="No tasks waiting for review"
              message="Work your team submits lands here."
            />
          )}
        </Card>
      </div>

      {/* ------------------------------------------ deadlines + issues */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Upcoming deadlines"
            subtitle="Your team's next due dates"
            action={
              <Link
                to="/operation-manager/calendar"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Calendar
              </Link>
            }
          />
          {recent.upcoming.length ? (
            <div className="divide-y divide-slate-100">
              {recent.upcoming.map((task) => (
                <div key={task._id} className="flex items-start justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {task.assignedTo?.name || "Unassigned"} · {task.project?.name || "No project"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      dayLabel(task.dueDate).includes("overdue") ? "text-red-600" : "text-slate-500"
                    }`}
                  >
                    {dayLabel(task.dueDate)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="Nothing scheduled"
              message="Tasks with a due date appear here as the dates approach."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Open issues"
            subtitle="Blockers raised on your projects"
            action={
              <Link
                to="/operation-manager/issues"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View issues
              </Link>
            }
          />
          {issues.open ? (
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2">
                {["critical", "high", "medium"].map((severity) => (
                  <div key={severity} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONES[SEVERITY_TONE[severity]].dot}`}
                      />
                      <p className="truncate text-[11px] font-medium text-slate-500">
                        {prettify(severity)}
                      </p>
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold tracking-tight ${TONES[SEVERITY_TONE[severity]].value}`}
                    >
                      {issues[severity] ?? 0}
                    </p>
                  </div>
                ))}
              </div>

              {issues.latest && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start gap-2">
                    <MessageSquareWarning size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-400">Latest unresolved</p>
                      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">
                        {issues.latest.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {prettify(issues.latest.severity)} ·{" "}
                        {issues.latest.raisedBy?.name || "Someone"} ·{" "}
                        {whenLabel(issues.latest.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Gauge}
              title="No open issues"
              message="Nothing on your projects is blocked right now."
            />
          )}
        </Card>
      </div>

      {/* A trend belongs where somebody goes looking for it */}
      <p className="mt-4 text-center text-[11px] text-slate-400">
        Looking for delivery trends and monthly history?{" "}
        <Link to="/operation-manager/reports" className="font-medium text-blue-600 hover:underline">
          Open Reports
        </Link>
      </p>
    </div>
  );
}
