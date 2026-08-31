import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { ArrowLeft } from "lucide-react";

import adminApi from "../adminApi";
import { CHART, SERIES, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify, money } from "../../shared/format";
import DataTable from "../../shared/components/DataTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const toChartData = (obj = {}) => Object.entries(obj).map(([name, value]) => ({ name, value }));

/* --------------------------------------------------- per-metric table cols */

const COLUMNS = {
  clients: [
    {
      key: "name",
      header: "Client",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.company || row.name}</p>
          <p className="text-xs text-slate-400">{row.name}</p>
        </div>
      ),
    },
    {
      key: "email",
      header: "Login ID",
      render: (row) => <span className="font-mono text-xs">{row.email}</span>,
    },
    {
      key: "projects",
      header: "Projects",
      render: (row) => `${row.completed} of ${row.projects} delivered`,
    },
    { key: "avgProgress", header: "Progress", render: (row) => <ProgressBar value={row.avgProgress} /> },
    { key: "budget", header: "Value", render: (row) => money(row.budget) },
    {
      key: "openIssues",
      header: "Open issues",
      render: (row) =>
        row.openIssues ? (
          <span className="font-medium text-red-600">{row.openIssues}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
  ],

  projects: [
    {
      key: "name",
      header: "Project",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.code || "—"}</p>
        </div>
      ),
    },
    { key: "client", header: "Client" },
    { key: "leader", header: "Team leader" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    {
      key: "tasks",
      header: "Tasks",
      render: (row) => `${row.tasksCompleted} / ${row.tasks}`,
    },
    { key: "budget", header: "Value", render: (row) => money(row.budget) },
    {
      key: "endDate",
      header: "Deadline",
      render: (row) => (
        <span className={row.overdue ? "font-medium text-red-600" : ""}>{fmt(row.endDate)}</span>
      ),
    },
  ],

  team: [
    {
      key: "name",
      header: "Person",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.designation || prettify(row.role)}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge tone={row.role === "team_leader" ? "black" : "blue"}>{prettify(row.role)}</Badge>
      ),
    },
    {
      key: "email",
      header: "Login ID",
      render: (row) => <span className="font-mono text-xs">{row.email}</span>,
    },
    { key: "department", header: "Department", render: (row) => row.department || "—" },
    { key: "reportsTo", header: "Reports to" },
    {
      key: "tasks",
      header: "Tasks",
      render: (row) =>
        row.role === "team_leader"
          ? `${row.projectsLed} projects led`
          : `${row.tasksCompleted} / ${row.tasks}`,
    },
    {
      key: "completionRate",
      header: "Completion",
      render: (row) => <ProgressBar value={row.completionRate} />,
    },
    { key: "attendanceRate", header: "Attendance", render: (row) => `${row.attendanceRate}%` },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
  ],

  budget: [
    {
      key: "name",
      header: "Project",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.code || "—"}</p>
        </div>
      ),
    },
    { key: "client", header: "Client" },
    { key: "leader", header: "Team leader" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    {
      key: "budget",
      header: "Contract value",
      render: (row) => <span className="font-medium text-slate-900">{money(row.budget)}</span>,
    },
    { key: "endDate", header: "Deadline", render: (row) => fmt(row.endDate) },
  ],
};

const EMPTY_TEXT = {
  clients: ["No clients yet", "Add a client to start tracking projects against them."],
  projects: ["No projects yet", "Create a project and assign a team leader."],
  team: ["Nobody added yet", "Add team leaders and employees from the sidebar."],
  budget: ["Nothing booked yet", "Project budgets show up here once projects exist."],
};

/** The page behind each dashboard stat card. */
export default function InsightDetails() {
  const { metric } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/insights/${metric}`)
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load this breakdown");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [metric]);

  // Each metric has its own route, so the component remounts when it changes
  if (loading) return <Loader />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const isMoney = Boolean(data.money);
  const formatValue = (value) => (isMoney ? money(value) : value);

  // Every metric gets a distribution chart; the source field differs
  const distribution = toChartData(data.byStatus || {});
  const secondary = toChartData(data.byPriority || data.byDepartment || data.byClient || {});
  const secondaryTitle = data.byPriority
    ? "By priority"
    : data.byDepartment
      ? "By department"
      : data.byClient
        ? "By client"
        : null;

  return (
    <div>
      <PageHeader title={data.title} subtitle={data.subtitle}>
        <Button variant="outline" onClick={() => navigate("/admin/dashboard")}>
          <ArrowLeft size={15} />
          Dashboard
        </Button>
      </PageHeader>

      {/* --------------------------------------------------- summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {data.summary.map((tile) => (
          <Card key={tile.label} className="p-5">
            <p className="text-xs font-medium text-slate-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {tile.money ? money(tile.value) : tile.value}
            </p>
          </Card>
        ))}
      </div>

      {/* --------------------------------------------------------- charts */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {distribution.length > 0 && (
          <Card>
            <CardHeader title={isMoney ? "Value by stage" : "Breakdown"} />
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {distribution.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name] || SERIES[i % SERIES.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, name) => [formatValue(value), prettify(name)]}
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
        )}

        {secondary.length > 0 && (
          <Card>
            <CardHeader title={secondaryTitle} />
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={secondary}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    {...axisProps}
                    tickFormatter={isMoney ? money : undefined}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    {...axisProps}
                    width={110}
                    tickFormatter={(value) =>
                      String(value).length > 15 ? `${String(value).slice(0, 14)}…` : prettify(value)
                    }
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, name, item) => [formatValue(value), item?.payload?.name]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
                    {secondary.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name] || SERIES[i % SERIES.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {data.trend && (
          <Card className={secondary.length ? "" : "lg:col-span-2"}>
            <CardHeader title={data.trendLabel} subtitle="Last 6 months" />
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="insightTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis
                    {...axisProps}
                    allowDecimals={false}
                    tickFormatter={isMoney ? money : undefined}
                    width={isMoney ? 64 : 32}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value) => [formatValue(value), data.trendLabel]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={CHART.blue}
                    strokeWidth={2}
                    fill="url(#insightTrend)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {/* ---------------------------------------------------------- table */}
      <Card className="mt-4">
        <CardHeader title="Full list" subtitle={`${data.rows.length} records`} />
        <DataTable
          columns={COLUMNS[metric] || []}
          rows={data.rows}
          emptyTitle={EMPTY_TEXT[metric]?.[0]}
          emptyMessage={EMPTY_TEXT[metric]?.[1]}
        />
      </Card>
    </div>
  );
}
