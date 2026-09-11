import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
  Megaphone,
  MessagesSquare,
  PlayCircle,
  Star,
  XCircle,
} from "lucide-react";

import employeeApi from "../employeeApi";
import { useEmployee } from "../employeeContext";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify, initialsOf } from "../../shared/format";
import {
  Alert,
  Card,
  CardHeader,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const toPieData = (obj = {}) => Object.entries(obj).map(([name, value]) => ({ name, value }));

/**
 * The four cards, the priority pills and the activity dots all read as one
 * traffic light: red needs you now, amber is moving, blue is waiting on
 * somebody else, green is done. Kept local to this screen — the shared Badge
 * palette is the app's own and deliberately has no green.
 */
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
  // Company-wide news is not urgent, not a status, and not the employee s own
  // work, so it sits outside the traffic light rather than borrowing a colour
  // that already means something.
  violet: {
    icon: "bg-violet-50 text-violet-600",
    value: "text-violet-600",
    dot: "bg-violet-500",
    pill: "bg-violet-50 text-violet-700 ring-violet-200",
  },
  slate: {
    icon: "bg-slate-100 text-slate-600",
    value: "text-slate-900",
    dot: "bg-slate-400",
    pill: "bg-slate-100 text-slate-700 ring-slate-200",
  },
};

const PRIORITY_TONE = { high: "red", medium: "amber", low: "slate" };

const ACTIVITY_TONE = {
  assigned: "blue",
  submitted: "amber",
  reviewed: "blue",
  completed: "green",
  log: "slate",
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

// "Rahul Verma" greets better as "Rahul"; an empty name still greets somebody.
const firstNameOf = (name = "") => name.trim().split(/s+/)[0] || "there";

const timeLabel = (value) =>
  new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Today shows a clock, yesterday says so, anything older gets a date. */
const whenLabel = (value) => {
  const at = new Date(value);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday - new Date(at).setHours(0, 0, 0, 0)) / 86400000);

  if (days <= 0) return timeLabel(at);
  if (days === 1) return "Yesterday";
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

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

/**
 * A count is only useful if it is also a door. Every one of these opens the
 * task list already filtered to what the number counted, so "3 due today" is
 * one click away from those three tasks rather than a number to go hunting for.
 */
function StatusCard({ icon: Icon, label, value, sub, tone, to }) {
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
        {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
      </Card>
    </Link>
  );
}

/** One row of "Today's priority" — an open task, or something already done. */
function PriorityRow({ task, done = false }) {
  const tone = TONES[done ? "green" : PRIORITY_TONE[task.priority] || "slate"];
  const overdue = !done && task.dueDate && new Date(task.dueDate) < new Date().setHours(0, 0, 0, 0);

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
      <span
        className={`inline-flex w-[68px] shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone.pill}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {done ? "Done" : prettify(task.priority)}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${
            done ? "text-slate-500 line-through" : "text-slate-800"
          }`}
        >
          {task.title}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {done
            ? `Completed ${timeLabel(task.completedAt)}`
            : `${dayLabel(task.dueDate)} • ${task.project?.name || "No project"}`}
        </p>
      </div>

      {!done && (
        <Link
          to={`/employee/tasks/details?id=${task._id}`}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
            overdue
              ? "bg-red-600 text-white hover:bg-red-700"
              : "border border-slate-300 text-slate-700 hover:bg-slate-100"
          }`}
        >
          {task.status === "in_progress" ? "Continue" : "Open task"}
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ notifications
 *
 * A notification is only useful if its shape is readable before its words are.
 * Stored on the model is a single `type`, which is coarser than the strip at
 * the top of this screen needs: "task" covers both "here is new work" and
 * "this is due today", and those are opposite messages — one is a gift, the
 * other is a debt.
 *
 * So the type picks the default, and a small number of high-signal words in
 * the title narrow it: a deadline makes it red, a decision that went the
 * employee's way makes it green, one that did not makes it red and says so.
 * Every branch falls back to the type's own styling, so a wrongly-worded
 * notification is merely generic rather than mislabelled.
 */
const NOTE_KINDS = {
  due: { tone: "red", icon: CalendarClock, label: "Due" },
  declined: { tone: "red", icon: XCircle, label: "Declined" },
  issue: { tone: "red", icon: AlertTriangle, label: "Issue" },
  review: { tone: "amber", icon: ClipboardCheck, label: "Review" },
  chat: { tone: "amber", icon: MessagesSquare, label: "Message" },
  task: { tone: "blue", icon: ClipboardList, label: "New task" },
  project: { tone: "blue", icon: FolderKanban, label: "Project" },
  approved: { tone: "green", icon: CheckCircle2, label: "Approved" },
  announcement: { tone: "violet", icon: Megaphone, label: "Announcement" },
  general: { tone: "slate", icon: Bell, label: "Update" },
};

const DUE_WORDS = /\b(due|overdue|deadline|expiring|reminder)\b/i;
const APPROVED_WORDS = /\b(approved|accepted|granted|sanctioned)\b/i;
const DECLINED_WORDS = /\b(rejected|declined|denied|cancelled|canceled)\b/i;

const noteKind = (note) => {
  const text = `${note.title || ""} ${note.message || ""}`;

  // A decision outranks the category it arrived under: "leave approved" is
  // news about an outcome first and an HR notification second.
  if (DECLINED_WORDS.test(text)) return "declined";
  if (APPROVED_WORDS.test(text)) return "approved";

  switch (note.type) {
    case "task":
      return DUE_WORDS.test(text) ? "due" : "task";
    case "review":
      return "review";
    case "chat":
      return "chat";
    case "issue":
      return "issue";
    case "project":
      return "project";
    // Nothing in the app addresses the whole company yet, so "system" is the
    // closest thing to an announcement there is. When a real announcement type
    // lands, it maps here and nothing else on this screen has to change.
    case "system":
      return "announcement";
    default:
      return DUE_WORDS.test(text) ? "due" : "general";
  }
};

/**
 * One notification, readable at a glance: what kind of thing it is, whether it
 * has been seen, and a way into whatever it is talking about. Rendered as a
 * link only when there is somewhere to go — a dead click is worse than none.
 */
function NotificationRow({ note }) {
  const kind = NOTE_KINDS[noteKind(note)] || NOTE_KINDS.general;
  const tone = TONES[kind.tone];
  const Icon = kind.icon;

  const inner = (
    <>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
      >
        <Icon size={15} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone.pill}`}
          >
            {kind.label}
          </span>
          {!note.read && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />}
          <p
            className={`truncate text-sm ${
              note.read ? "text-slate-600" : "font-medium text-slate-800"
            }`}
          >
            {note.title}
          </p>
        </div>
        {note.message && (
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{note.message}</p>
        )}
      </div>

      <span className="shrink-0 text-[11px] text-slate-400">{whenLabel(note.createdAt)}</span>
    </>
  );

  const className = "flex items-center gap-3 px-5 py-3";

  return note.link ? (
    <Link to={note.link} className={`${className} hover:bg-slate-50`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/**
 * One number from the performance strip.
 *
 * `value` may legitimately be null — an on-time rate with no dated work behind
 * it has no answer, and printing 0% there would read as a failure rather than
 * as silence.
 */
function SnapshotStat({ label, value, suffix = "", hint, tone = "slate", to }) {
  const t = TONES[tone];

  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${t.value}`}>
        {value === null || value === undefined ? (
          <span className="text-slate-300">—</span>
        ) : (
          <>
            {value}
            {suffix && <span className="ml-0.5 text-base font-semibold">{suffix}</span>}
          </>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
    </>
  );

  return to ? (
    <Link to={to} className="block rounded-lg p-3 transition-colors hover:bg-slate-50">
      {body}
    </Link>
  ) : (
    <div className="p-3">{body}</div>
  );
}

export default function Dashboard() {
  const { employee } = useEmployee() || {};
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/dashboard")
      .then(({ data: res }) => active && setData(res))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your dashboard");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader label="Loading your workspace..." />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { stats, charts, recent, leader } = data;
  const taskPie = toPieData(charts.tasksByStatus);
  const attendancePie = toPieData(charts.attendanceThisMonth);

  // Older payloads have none of these; an empty list renders as "nothing here".
  const priority = recent.priority || [];
  const doneToday = recent.doneToday || [];
  const activity = recent.activity || [];
  const unread = recent.unreadNotifications || [];

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${firstNameOf(employee?.name)}`}
        subtitle={
          priority.length
            ? `${dateLabel} — ${priority.length} ${
                priority.length === 1 ? "task needs" : "tasks need"
              } you today`
            : `${dateLabel} — nothing due today`
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={CalendarClock}
          label="Due today"
          value={stats.dueToday}
          sub={stats.overdueTasks ? `${stats.overdueTasks} overdue` : "Nothing overdue"}
          tone="red"
          to="/employee/tasks/today"
        />
        <StatusCard
          icon={PlayCircle}
          label="In progress"
          value={stats.tasksInProgress ?? 0}
          sub={`${stats.tasksNotStarted ?? 0} not started yet`}
          tone="amber"
          to="/employee/tasks/in-progress"
        />
        <StatusCard
          icon={ClipboardCheck}
          label="Waiting for review"
          value={stats.tasksInReview}
          sub="With your operations manager"
          tone="blue"
          to="/employee/tasks/review"
        />
        <StatusCard
          icon={CheckCircle2}
          label="Completed"
          value={stats.tasksCompleted}
          sub={`${stats.completionRate}% of everything assigned`}
          tone="green"
          to="/employee/tasks/completed"
        />
      </div>

      {/* ------------------------------------------------- needs your attention
       *
       * The bell in the topbar is a count, and a count is a thing you have to
       * decide to go and open. The five unread ones are put here instead,
       * above everything the employee scrolls past, because "your leave was
       * approved" and "your manager commented on your work" are the two things
       * most likely to change what they do next — and both used to be a click
       * away on a screen nobody visits.
       *
       * Nothing renders when there is nothing unread: an empty card that says
       * "all caught up" every day is a card people stop seeing.
       */}
      {unread.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Needs your attention"
            subtitle={`${unread.length} unread ${
              unread.length === 1 ? "notification" : "notifications"
            }`}
            action={
              <Link
                to="/employee/notifications"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Open all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {unread.map((note) => (
              <NotificationRow key={note._id} note={note} />
            ))}
          </div>
        </Card>
      )}

      {/* ------------------------------------- what to do now, and what happened */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's priority"
            subtitle="Highest priority first, overdue work included"
            action={
              <Link
                to="/employee/tasks/today"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!priority.length && !doneToday.length && (
              <p className="px-5 py-10 text-center text-xs text-slate-400">
                Nothing needs you today — you are all caught up.
              </p>
            )}
            {priority.map((task) => (
              <PriorityRow key={task._id} task={task} />
            ))}
            {doneToday.map((task) => (
              <PriorityRow key={task._id} task={task} done />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="What happened around your work" />
          <div className="px-5 py-2">
            {!activity.length && (
              <p className="py-8 text-center text-xs text-slate-400">Nothing yet</p>
            )}
            {activity.map((row) => (
              <Link key={row.id} to={row.link} className="flex gap-3 py-2.5">
                <span className="flex flex-col items-center pt-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      (TONES[ACTIVITY_TONE[row.kind]] || TONES.slate).dot
                    }`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-slate-700">{row.text}</p>
                  {row.detail && (
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{row.detail}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{whenLabel(row.at)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Task completion</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.completionRate}%</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar value={stats.completionRate} />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {stats.tasksCompleted} of {stats.tasksTotal} tasks done
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Review rating</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stats.avgRating ? `${stats.avgRating} / 5` : "—"}
              </p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Star size={18} />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={15}
                className={
                  star <= Math.round(stats.avgRating)
                    ? "fill-blue-600 text-blue-600"
                    : "text-slate-300"
                }
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Across {stats.ratedTasks} reviewed tasks
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-slate-600">Your operations manager</p>
          {leader ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                {initialsOf(leader.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{leader.name}</p>
                <p className="truncate text-[11px] text-slate-400">
                  {leader.designation || leader.email}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Not assigned yet</p>
          )}
          <Link
            to="/employee/chat/operation-manager"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Send a message →
          </Link>
        </Card>
      </div>

      {/* ------------------------------------------------------ charts row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* --------------------------------------------- performance snapshot
         *
         * A six-month completion trend used to sit here. It answered a
         * question an employee does not ask daily — the shape of last spring —
         * and answered nothing about today. These five do: what is finished,
         * whether it lands on time, what is still owed, how much has been
         * looked at, and what it was judged to be worth.
         */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Your performance"
            subtitle="Across everything assigned to you"
            action={
              <Link
                to="/employee/incentive"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                See incentive
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 lg:grid-cols-5">
            <SnapshotStat
              label="Tasks completed"
              value={stats.tasksCompleted}
              hint={`of ${stats.tasksTotal} assigned`}
              tone="green"
              to="/employee/tasks/completed"
            />
            <SnapshotStat
              label="On-time"
              value={stats.onTimeRate}
              suffix="%"
              hint={
                stats.onTimeRate === null
                  ? "no dated work yet"
                  : `${stats.tasksLate || 0} finished late`
              }
              tone="blue"
              to="/employee/incentive"
            />
            <SnapshotStat
              label="Pending"
              value={stats.tasksPending}
              hint={
                stats.overdueTasks ? `${stats.overdueTasks} overdue` : "nothing overdue"
              }
              tone={stats.overdueTasks ? "red" : "amber"}
              to="/employee/tasks/pending"
            />
            <SnapshotStat
              label="Reviewed"
              value={stats.ratedTasks}
              hint="rated by your manager"
              tone="slate"
              to="/employee/tasks/review"
            />
            <SnapshotStat
              label="Avg. rating"
              value={stats.avgRating ? `${stats.avgRating} ★` : null}
              hint={stats.ratedTasks ? "out of 5" : "nothing rated yet"}
              tone="amber"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Tasks by status" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {taskPie.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.grey} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v, n) => [v, prettify(n)]} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ color: CHART.slate, fontSize: 12 }}>{prettify(value)}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Hours logged" subtitle="Last 7 days from your daily work log" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.hoursByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} unit="h" />
                <Tooltip {...tooltipStyle} formatter={(value) => [`${value} h`, "Logged"]} />
                <Bar dataKey="hours" fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your attendance" subtitle="This month" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendancePie}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={76}
                  stroke="none"
                  label={({ percent }) => `${Math.round(percent * 100)}%`}
                  labelLine={false}
                >
                  {attendancePie.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.grey} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v, n) => [v, prettify(n)]} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ color: CHART.slate, fontSize: 12 }}>{prettify(value)}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* -------------------------------------------------------- lists row
       *
       * "Due today" used to live here as well. It is the top half of Today's
       * priority now, and a screen that says the same thing twice is a screen
       * where neither half gets read.
       */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Coming up" subtitle="Your next deadlines" />
          <div className="divide-y divide-slate-100">
            {!recent.upcoming.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">Nothing scheduled</p>
            )}
            {recent.upcoming.map((task) => (
              <Link
                key={task._id}
                to={`/employee/tasks/details?id=${task._id}`}
                className="flex items-start justify-between gap-2 px-5 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {task.project?.name || "No project"}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-slate-500">
                  {dayLabel(task.dueDate)}
                </span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Notifications"
            subtitle="Everything recent, read or not"
            action={
              <Link
                to="/employee/notifications"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!recent.notifications.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">Nothing new</p>
            )}
            {recent.notifications.map((note) => (
              <NotificationRow key={note._id} note={note} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
