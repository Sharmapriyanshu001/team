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
  FolderKanban,
  UsersRound,
  ClipboardCheck,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
} from "lucide-react";

import leaderApi from "../leaderApi";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify } from "../../shared/format";
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
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(date).setHours(0, 0, 0, 0) - today) / 86400000);

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

  const { stats, charts, recent } = data;
  const taskPie = toPieData(charts.tasksByStatus);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your projects, your team and what needs your attention today"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FolderKanban}
          label="My Projects"
          value={stats.projects}
          sub={`${stats.activeProjects} active · ${stats.completedProjects} closed`}
          accent="blue"
          to="/team-leader/projects/active"
        />
        <StatCard
          icon={UsersRound}
          label="Team Members"
          value={stats.teamSize}
          sub="Reporting to you"
          accent="black"
          to="/team-leader/team"
        />
        <StatCard
          icon={ClipboardCheck}
          label="Waiting for review"
          value={stats.tasksInReview}
          sub="Sign off or send back"
          accent="light"
          to="/team-leader/daily-review"
        />
        <StatCard
          icon={AlertTriangle}
          label="Open issues"
          value={stats.openIssues}
          sub={`${stats.overdueTasks} tasks overdue`}
          accent="blue"
          to="/team-leader/issues"
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
              <p className="text-sm font-medium text-slate-600">Average project progress</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.avgProgress}%</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
              <FolderKanban size={18} />
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar value={stats.avgProgress} />
          </div>
          <Link
            to="/team-leader/progress"
            className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Open progress board →
          </Link>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Open tasks</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.tasksPending}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <CalendarClock size={18} />
            </span>
          </div>
          <Link
            to="/team-leader/tasks/pending"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            View pending tasks →
          </Link>
        </Card>
      </div>

      {/* ------------------------------------------------------ charts row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Team delivery"
            subtitle="Tasks your team completed, last 6 months"
          />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={charts.monthlyTrend}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="leaderTrend" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#leaderTrend)"
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

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Project progress" subtitle="Where each of your projects stands" />
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={charts.projectProgress}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} unit="%" {...axisProps} />
                <YAxis
                  type="category"
                  dataKey="name"
                  {...axisProps}
                  width={130}
                  tickFormatter={(value) =>
                    value.length > 18 ? `${value.slice(0, 17)}…` : value
                  }
                />
                <Tooltip {...tooltipStyle} formatter={(value) => [`${value}%`, "Progress"]} />
                <Bar dataKey="progress" radius={[0, 6, 6, 0]} maxBarSize={22}>
                  {charts.projectProgress.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.status] || CHART.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Team workload" subtitle="Completed vs still open, per member" />
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={charts.teamWorkload}
                margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  {...axisProps}
                  tickFormatter={(value) => String(value).split(" ")[0]}
                />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="completed" name="Completed" stackId="w" fill={CHART.blue} maxBarSize={34} />
                <Bar
                  dataKey="pending"
                  name="Open"
                  stackId="w"
                  fill={CHART.bluePale}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------ lists row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Waiting for your review"
            action={
              <Link
                to="/team-leader/daily-review"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Review
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!recent.pendingReviews.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">Nothing pending</p>
            )}
            {recent.pendingReviews.map((task) => (
              <div key={task._id} className="px-5 py-3">
                <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {task.assignedTo?.name || "Unassigned"} · {task.project?.name || "No project"}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Upcoming deadlines"
            action={
              <Link
                to="/team-leader/calendar"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Calendar
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!recent.upcoming.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">Nothing scheduled</p>
            )}
            {recent.upcoming.map((task) => (
              <div key={task._id} className="flex items-start justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {task.assignedTo?.name || "Unassigned"}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] font-medium ${
                    dayLabel(task.dueDate).includes("overdue")
                      ? "text-red-600"
                      : "text-slate-500"
                  }`}
                >
                  {dayLabel(task.dueDate)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent projects"
            action={
              <Link
                to="/team-leader/projects/active"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {recent.projects.map((project) => (
              <div key={project._id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                  <Badge value={project.status} />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {project.client?.company || project.client?.name || "No client"}
                </p>
                <div className="mt-2">
                  <ProgressBar value={project.progress} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
