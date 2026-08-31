import { useEffect, useState } from "react";
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
import { Download, RefreshCw } from "lucide-react";

import adminApi from "../adminApi";
import DataTable from "../../shared/components/DataTable";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify } from "../../shared/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  PageHeader,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const money = (value = 0) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Number(value).toLocaleString("en-IN")}`;
};

const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

// Quote a value so commas inside names do not break the CSV.
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function Reports() {
  const [from, setFrom] = useState(monthsAgo(5));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reloadKey, setReloadKey] = useState(0);

  // `loading` is switched on by the date handlers / refresh button, off here.
  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/reports", { params: { from, to } })
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not build the report");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [from, to, reloadKey]);

  const reload = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const changeFrom = (value) => {
    setLoading(true);
    setFrom(value);
  };

  const changeTo = (value) => {
    setLoading(true);
    setTo(value);
  };

  const exportCsv = () => {
    if (!data) return;

    const header = ["Project", "Client", "Team leader", "Status", "Progress", "Budget", "Start", "End"];
    const rows = data.projects.map((p) => [
      p.name,
      p.client?.company || p.client?.name || "",
      p.teamLeader?.name || "",
      prettify(p.status),
      `${p.progress}%`,
      p.budget,
      p.startDate ? new Date(p.startDate).toLocaleDateString("en-IN") : "",
      p.endDate ? new Date(p.endDate).toLocaleDateString("en-IN") : "",
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = `jha-report-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const projectColumns = [
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
    {
      key: "client",
      header: "Client",
      render: (row) => row.client?.company || row.client?.name || "—",
    },
    { key: "teamLeader", header: "Leader", render: (row) => row.teamLeader?.name || "—" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "progress", header: "Progress", render: (row) => `${row.progress}%` },
    { key: "budget", header: "Budget", render: (row) => money(row.budget) },
  ];

  return (
    <div>
      <PageHeader title="Reports" subtitle="Delivery, revenue and workload for any date range">
        <Button variant="outline" onClick={reload}>
          <RefreshCw size={15} />
          Refresh
        </Button>
        <Button onClick={exportCsv} disabled={!data}>
          <Download size={15} />
          Export CSV
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4 p-4">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => changeFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => changeTo(e.target.value)} />
          </Field>
          <p className="pb-2 text-xs text-slate-400">
            Showing everything created between these two dates.
          </p>
        </div>
      </Card>

      {loading ? (
        <Loader label="Building report..." />
      ) : !data ? null : (
        <>
          {/* ------------------------------------------------ summary tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "Projects", value: data.summary.projects },
              { label: "Completed", value: data.summary.completedProjects },
              { label: "Budget booked", value: money(data.summary.totalBudget) },
              { label: "Tasks", value: data.summary.tasks },
              { label: "Issues", value: data.summary.issues },
            ].map((tile) => (
              <Card key={tile.label} className="p-4">
                <p className="text-xs font-medium text-slate-500">{tile.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{tile.value}</p>
              </Card>
            ))}
          </div>

          {/* ----------------------------------------------- revenue + tasks */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Budget booked per month" subtitle="Sum of project budgets by creation month" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.revenueByMonth} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={CHART.blue} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={money} width={70} />
                    <Tooltip {...tooltipStyle} formatter={(value) => [money(value), "Budget"]} />
                    <Area
                      type="monotone"
                      dataKey="budget"
                      stroke={CHART.blue}
                      strokeWidth={2}
                      fill="url(#revGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Tasks by status" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.tasksByStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={54}
                      outerRadius={84}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {data.tasksByStatus.map((entry) => (
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

          {/* --------------------------------------------- clients + workload */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top clients" subtitle="By number of projects in this range" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.topClients}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
                    <XAxis type="number" {...axisProps} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" {...axisProps} width={110} />
                    <Tooltip {...tooltipStyle} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="projects" name="Projects" fill={CHART.blue} radius={[0, 6, 6, 0]} maxBarSize={20} />
                    <Bar dataKey="completed" name="Completed" fill={CHART.black} radius={[0, 6, 6, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Team workload" subtitle="Tasks assigned vs completed" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.workload} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis
                      dataKey="name"
                      {...axisProps}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={56}
                      tickFormatter={(value) => String(value).split(" ")[0]}
                    />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="completed" name="Completed" stackId="w" fill={CHART.blue} maxBarSize={26} />
                    <Bar
                      dataKey="pending"
                      name="Pending"
                      stackId="w"
                      fill={CHART.bluePale}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={26}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------- project table */}
          <Card className="mt-4">
            <CardHeader
              title="Projects in this range"
              subtitle={`${data.projects.length} shown · export for the full list`}
            />
            <DataTable
              columns={projectColumns}
              rows={data.projects}
              emptyTitle="No projects in this range"
              emptyMessage="Widen the date range to see more."
            />
          </Card>
        </>
      )}
    </div>
  );
}
