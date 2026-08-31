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
  Gauge,
  CalendarClock,
  Star,
  IndianRupee,
  FolderOpen,
} from "lucide-react";

import clientApi from "../clientApi";
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

const money = (value = 0) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Number(value).toLocaleString("en-IN")}`;
};

const meetingWhen = (value) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

    clientApi
      .get("/client/dashboard")
      .then(({ data: res }) => active && setData(res))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your dashboard");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader label="Loading your projects..." />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { stats, charts, recent } = data;
  const taskPie = toPieData(charts.tasksByStatus);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Where your projects stand and what's coming up"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FolderKanban}
          label="My Projects"
          value={stats.projects}
          sub={`${stats.activeProjects} running · ${stats.completedProjects} delivered`}
          accent="blue"
          to="/client/projects"
        />
        <StatCard
          icon={Gauge}
          label="Average progress"
          value={`${stats.avgProgress}%`}
          sub={`${stats.completionRate}% of tasks done`}
          accent="black"
          to="/client/progress"
        />
        <StatCard
          icon={CalendarClock}
          label="Upcoming meetings"
          value={stats.upcomingMeetings}
          sub={stats.pendingRequests ? `${stats.pendingRequests} awaiting confirmation` : "Nothing pending"}
          accent="light"
          to="/client/meetings"
        />
        <StatCard
          icon={IndianRupee}
          label="Contract value"
          value={money(stats.totalBudget)}
          sub="Across all your projects"
          accent="blue"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Delivery progress</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.completionRate}%</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Gauge size={18} />
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar value={stats.completionRate} />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {stats.tasksCompleted} of {stats.tasksTotal} work items completed
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Your rating of us</p>
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
          <Link
            to="/client/feedback"
            className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            {stats.feedbackCount ? "Share more feedback →" : "Leave your first feedback →"}
          </Link>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Shared documents</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.files}</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <FolderOpen size={18} />
            </span>
          </div>
          <Link
            to="/client/files"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Open your documents →
          </Link>
        </Card>
      </div>

      {/* ------------------------------------------------------ charts row */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Work completed" subtitle="Items closed on your projects, last 6 months" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={charts.monthlyTrend}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="clientTrend" x1="0" y1="0" x2="0" y2="1">
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
                  name="Work items completed"
                  stroke={CHART.blue}
                  strokeWidth={2}
                  fill="url(#clientTrend)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Work breakdown" subtitle="Across all your projects" />
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
          <CardHeader title="Project progress" subtitle="Where each project stands today" />
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
                  width={150}
                  tickFormatter={(value) => (value.length > 20 ? `${value.slice(0, 19)}…` : value)}
                />
                <Tooltip {...tooltipStyle} formatter={(value) => [`${value}%`, "Progress"]} />
                <Bar dataKey="progress" radius={[0, 6, 6, 0]} maxBarSize={24}>
                  {charts.projectProgress.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.status] || CHART.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Upcoming meetings"
            action={
              <Link
                to="/client/meetings"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                View all
              </Link>
            }
          />
          <div className="divide-y divide-slate-100">
            {!recent.meetings.length && (
              <p className="px-5 py-8 text-center text-xs text-slate-400">
                Nothing scheduled — request a meeting any time.
              </p>
            )}
            {recent.meetings.map((meeting) => (
              <div key={meeting._id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-800">{meeting.title}</p>
                  <Badge tone="blue">{prettify(meeting.mode)}</Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {meetingWhen(meeting.scheduledAt)} · {meeting.durationMinutes} min
                </p>
                {meeting.organizer && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white">
                      {initialsOf(meeting.organizer.name)}
                    </span>
                    {meeting.organizer.name}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your projects"
            action={
              <Link
                to="/client/projects"
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
                  Lead: {project.teamLeader?.name || "To be assigned"}
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
            title="Updates"
            action={
              <Link
                to="/client/notifications"
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
