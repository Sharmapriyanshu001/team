import { useEffect, useState } from "react";
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
import { Download, RefreshCw } from "lucide-react";

import leaderApi from "../leaderApi";
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
  ProgressBar,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function Reports() {
  const [from, setFrom] = useState(monthsAgo(2));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/reports", { params: { from, to } })
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

    const header = ["Project", "Client", "Status", "Progress", "Tasks completed in range", "Deadline"];
    const rows = data.projects.map((p) => [
      p.name,
      p.client,
      prettify(p.status),
      `${p.progress}%`,
      p.tasksCompletedInRange,
      p.endDate ? new Date(p.endDate).toLocaleDateString("en-IN") : "",
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = `my-team-report-${from}-to-${to}.csv`;
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
    { key: "client", header: "Client" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    {
      key: "tasksCompletedInRange",
      header: "Tasks closed",
      render: (row) => row.tasksCompletedInRange,
    },
    {
      key: "endDate",
      header: "Deadline",
      render: (row) => (row.endDate ? new Date(row.endDate).toLocaleDateString("en-IN") : "—"),
    },
  ];

  return (
    <div>
      <PageHeader title="Reports" subtitle="Your team's delivery for any date range">
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
            Tasks and issues created between these two dates.
          </p>
        </div>
      </Card>

      {loading ? (
        <Loader label="Building report..." />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "Projects", value: data.summary.projects },
              { label: "Completed", value: data.summary.completedProjects },
              { label: "Tasks", value: data.summary.tasks },
              { label: "Completion", value: `${data.summary.completionRate}%` },
              { label: "Team size", value: data.summary.teamSize },
            ].map((tile) => (
              <Card key={tile.label} className="px-4 py-3">
                <p className="text-xs font-medium text-slate-500">{tile.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{tile.value}</p>
              </Card>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Team workload" subtitle="Tasks assigned vs completed in range" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.workload} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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
                      name="Pending"
                      stackId="w"
                      fill={CHART.bluePale}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={34}
                    />
                  </BarChart>
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
                      innerRadius={52}
                      outerRadius={82}
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

          <Card className="mt-4">
            <CardHeader title="Your projects" subtitle="Progress and what closed in this range" />
            <DataTable
              columns={projectColumns}
              rows={data.projects}
              emptyTitle="No projects"
              emptyMessage="Projects assigned to you will appear here."
            />
          </Card>
        </>
      )}
    </div>
  );
}
