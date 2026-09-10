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
  Users,
  FolderKanban,
  UsersRound,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  IndianRupee,
  ArrowUpRight,
} from "lucide-react";

import adminApi from "../adminApi";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify } from "../../shared/format";
import { Card, CardHeader, PageHeader, Badge, Loader, Alert, ProgressBar } from "../../shared/components/ui";

const axisProps = {
  tick: { fill: CHART.grey, fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

const compactMoney = (value = 0) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${value}`;
};

const toPieData = (obj = {}) =>
  Object.entries(obj).map(([name, value]) => ({ name, value }));

function StatCard({ icon: Icon, label, value, sub, accent = "blue", to }) {
  const accents = {
    blue: "bg-blue-600 text-white",
    black: "bg-slate-900 text-white",
    light: "bg-blue-50 text-blue-600",
  };

  const content = (
    <Card className="p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accents[accent]}`}>
          <Icon size={18} />
        </span>
        {to && <ArrowUpRight size={15} className="text-slate-300" />}
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </Card>
  );

  return to ? <Link to={to}>{content}</Link> : content;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .get("/admin/dashboard")
      .then(({ data: res }) => setData(res))
      .catch((err) => setError(err.response?.data?.message || "Could not load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader label="Loading dashboard..." />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { stats, charts, recent } = data;

  const taskPie = toPieData(charts.tasksByStatus);
  const projectBars = toPieData(charts.projectsByStatus);
  const attendancePie = toPieData(charts.attendanceThisMonth);
  const severityBars = toPieData(charts.issuesBySeverity);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live snapshot of clients, projects, people and delivery"
      />

      {/* ------------------------------------------------------ stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Users}
          label="Clients"
          value={stats.clients}
          sub={`${stats.activeClients} active`}
          accent="blue"
          to="/admin/insights/clients"
        />
        <StatCard
          icon={FolderKanban}
          label="Projects"
          value={stats.projects}
          sub={`${stats.activeProjects} running · ${stats.completedProjects} delivered`}
          accent="black"
          to="/admin/insights/projects"
        />
        <StatCard
          icon={UsersRound}
          label="Team Members"
          value={stats.operationsManagers + stats.employees}
          sub={`${stats.operationsManagers} leaders · ${stats.employees} employees`}
          accent="light"
          to="/admin/insights/team"
        />
        <StatCard
          icon={IndianRupee}
          label="Total Budget"
          value={compactMoney(stats.totalBudget)}
          sub="Across all projects"
          accent="blue"
          to="/admin/insights/budget"
        />
      </div>

      {/* ------------------------------------------------- secondary stats */}
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
              <p className="text-sm font-medium text-slate-600">Pending tasks</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.tasksPending}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
              <TrendingUp size={18} />
            </span>
          </div>
          <Link
            to="/admin/tasks/pending"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            View pending tasks →
          </Link>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Open issues</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.openIssues}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <AlertTriangle size={18} />
            </span>
          </div>
          <Link
            to="/admin/issues"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Review issues →
          </Link>
        </Card>
      </div>

      {/* ----------------------------------------------------- trend + pie */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Delivery trend"
            subtitle="New projects vs tasks completed, last 6 months"
          />
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.monthlyTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.blue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradBlack" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.black} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART.black} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey="tasksCompleted"
                  name="Tasks completed"
                  stroke={CHART.blue}
                  strokeWidth={2}
                  fill="url(#gradBlue)"
                />
                <Area
                  type="monotone"
                  dataKey="projects"
                  name="New projects"
                  stroke={CHART.black}
                  strokeWidth={2}
                  fill="url(#gradBlack)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Tasks by status" subtitle="Current workload split" />
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={2}
                  stroke="none"
                >
                  {taskPie.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.grey} />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => [value, prettify(name)]}
                />
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

      {/* --------------------------------------- projects / attendance / severity */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Projects by status" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectBars} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  {...axisProps}
                  tickFormatter={(value) => prettify(value).split(" ")[0]}
                />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name, item) => [value, prettify(item?.payload?.name)]}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {projectBars.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Attendance" subtitle="This month, all staff" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendancePie}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={82}
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

        <Card>
          <CardHeader title="Issues by severity" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={severityBars}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  {...axisProps}
                  width={62}
                  tickFormatter={prettify}
                />
                <Tooltip {...tooltipStyle} formatter={(v, n, i) => [v, prettify(i?.payload?.name)]} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26}>
                  {severityBars.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------ performers / projects / feed */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top performers" subtitle="By completed tasks" />
          <div className="divide-y divide-slate-100">
            {charts.topPerformers.length === 0 && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">No data yet</p>
            )}
            {charts.topPerformers.map((performer, i) => (
              <div key={performer.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    i === 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{performer.name}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {prettify(performer.designation)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-slate-900">
                  {performer.completed}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent projects"
            action={
              <Link to="/admin/projects" className="text-xs font-medium text-blue-600 hover:underline">
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
                  {project.client?.company || project.client?.name || "No client"} ·{" "}
                  {project.operationsManager?.name || "Unassigned"}
                </p>
                <div className="mt-2">
                  <ProgressBar value={project.progress} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            action={
              <Link
                to="/admin/activity-logs"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {recent.activity.map((log) => (
              <div key={log._id} className="flex gap-3 px-5 py-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">{log.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {log.actorName} · {new Date(log.createdAt).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
