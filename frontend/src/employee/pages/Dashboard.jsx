import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
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
  ListChecks,
  ClipboardCheck,
  CalendarClock,
  Star,
  FolderKanban,
  CheckCircle2,
} from "lucide-react";

import employeeApi from "../employeeApi";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify, initialsOf } from "../../shared/format";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const toPieData = (obj = {}) => Object.entries(obj).map(([name, value]) => ({ name, value }));

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

function StatCard({ icon: Icon, label, value, sub, accent = "blue", to }) {
  const accents = {
    blue: "bg-blue-600 text-white",
    black: "bg-slate-900 text-white",
    light: "bg-blue-50 text-blue-600",
  };

  const body = (
    <Card className="p-5 transition-shadow hover:shadow-md">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accents[accent]}`}>
        <Icon size={18} />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </Card>
  );

  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
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

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="What's on your plate today" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={CalendarClock}
          label="Due today"
          value={stats.dueToday}
          sub={stats.overdueTasks ? `${stats.overdueTasks} overdue` : "Nothing overdue"}
          accent="blue"
          to="/employee/tasks/today"
        />
        <StatCard
          icon={ListChecks}
          label="Open tasks"
          value={stats.tasksPending}
          sub={`${stats.tasksTotal} assigned in total`}
          accent="black"
          to="/employee/tasks/pending"
        />
        <StatCard
          icon={ClipboardCheck}
          label="With your leader"
          value={stats.tasksInReview}
          sub="Submitted for review"
          accent="light"
          to="/employee/tasks/pending"
        />
        <StatCard
          icon={FolderKanban}
          label="My projects"
          value={stats.projects}
          sub={`${stats.activeProjects} active`}
          accent="blue"
          to="/employee/projects/active"
        />
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
          <p className="text-sm font-medium text-slate-600">Your team leader</p>
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
            to="/employee/chat/team-leader"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Send a message →
          </Link>
        </Card>
      </div>

      {/* ------------------------------------------------------ charts row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your delivery" subtitle="Tasks you completed, last 6 months" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={charts.monthlyTrend}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="empTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="tasksCompleted"
                  name="Tasks completed"
                  stroke={CHART.blue}
                  strokeWidth={2}
                  fill="url(#empTrend)"
                />
              </AreaChart>
            </ResponsiveContainer>
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

      {/* ------------------------------------------------------- lists row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Due today"
            action={
              <Link
                to="/employee/tasks/today"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Open
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!recent.dueToday.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">Nothing due today</p>
            )}
            {recent.dueToday.map((task) => (
              <Link
                key={task._id}
                to={`/employee/tasks/details?id=${task._id}`}
                className="block px-5 py-3 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                  <Badge value={task.priority} />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {task.project?.name || "No project"}
                </p>
              </Link>
            ))}
          </div>
        </Card>

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
              <div key={note._id} className="flex gap-3 px-5 py-3">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    note.read ? "bg-slate-300" : "bg-blue-600"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">{note.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{note.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
