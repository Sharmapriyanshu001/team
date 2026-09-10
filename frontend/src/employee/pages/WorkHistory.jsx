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
import { Download, History, Star } from "lucide-react";

import employeeApi from "../employeeApi";
import DataTable from "../../shared/components/DataTable";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../shared/theme";
import { prettify } from "../../shared/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
} from "../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function WorkHistory() {
  const [from, setFrom] = useState(monthsAgo(1));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("logs");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/history", { params: { from, to } })
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your history");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [from, to]);

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

    const header = ["Date", "Hours", "Summary", "Blockers", "Tasks"];
    const rows = data.logs.map((log) => [
      fmt(log.date),
      log.hours,
      log.summary,
      log.blockers,
      (log.tasks || []).map((t) => t.title).join("; "),
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = `my-work-log-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const logColumns = [
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{fmt(row.date)}</p>
          <p className="text-xs text-slate-400">
            {new Date(row.date).toLocaleDateString("en-IN", { weekday: "long" })}
          </p>
        </div>
      ),
    },
    { key: "hours", header: "Hours", render: (row) => `${row.hours} h` },
    {
      key: "summary",
      header: "What you did",
      render: (row) => <span className="text-slate-700">{row.summary}</span>,
    },
    {
      key: "blockers",
      header: "Blockers",
      render: (row) =>
        row.blockers ? (
          <span className="text-red-600">{row.blockers}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "tasks",
      header: "Tasks",
      render: (row) => (row.tasks?.length ? `${row.tasks.length}` : "—"),
    },
  ];

  const taskColumns = [
    {
      key: "title",
      header: "Task",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title}</p>
          <p className="text-xs text-slate-400">{row.project?.name || "No project"}</p>
        </div>
      ),
    },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    {
      key: "reviewRating",
      header: "Rating",
      render: (row) => (
        <span className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={13}
              className={
                star <= (row.reviewRating || 0) ? "fill-blue-600 text-blue-600" : "text-slate-300"
              }
            />
          ))}
        </span>
      ),
    },
    {
      key: "reviewNote",
      header: "Leader's note",
      render: (row) => row.reviewNote || <span className="text-slate-400">—</span>,
    },
    { key: "completedAt", header: "Closed", render: (row) => fmt(row.completedAt) },
  ];

  const attendancePie = data
    ? Object.entries(data.attendance).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div>
      <PageHeader title="Work History" subtitle="Your logged days and everything you have closed">
        <Button onClick={exportCsv} disabled={!data?.logs.length}>
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
        </div>
      </Card>

      {loading ? (
        <Loader />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              ["Days logged", data.summary.daysLogged],
              ["Total hours", `${data.summary.totalHours} h`],
              ["Avg per day", `${data.summary.avgHours} h`],
              ["Tasks closed", data.summary.tasksCompleted],
              ["Avg rating", data.summary.avgRating ? `${data.summary.avgRating} / 5` : "—"],
            ].map(([label, value]) => (
              <Card key={label} className="px-4 py-3">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
              </Card>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Hours logged" subtitle="Every day you filled in a work log" />
              <div className="h-64 p-4">
                {data.hoursByDay.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.hoursByDay}
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                      <YAxis {...axisProps} unit="h" />
                      <Tooltip {...tooltipStyle} formatter={(value) => [`${value} h`, "Logged"]} />
                      <Bar dataKey="hours" fill={CHART.blue} radius={[5, 5, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    icon={History}
                    title="No logs in this range"
                    message="Fill in your Daily Work log to build up a history."
                  />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Attendance" subtitle="Marked by the admin" />
              <div className="h-64 p-4">
                {attendancePie.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={attendancePie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={76}
                        paddingAngle={2}
                        stroke="none"
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
                          <span style={{ color: CHART.slate, fontSize: 12 }}>
                            {prettify(value)}
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    icon={History}
                    title="No attendance yet"
                    message="Your admin marks attendance daily."
                  />
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 flex gap-2">
            {[
              ["logs", "Work logs", data.logs.length],
              ["tasks", "Closed tasks", data.completed.length],
            ].map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
                <span className="ml-1.5 text-xs opacity-60">{count}</span>
              </button>
            ))}
          </div>

          <Card className="mt-3">
            {tab === "logs" ? (
              <DataTable
                columns={logColumns}
                rows={data.logs}
                emptyTitle="No work logs"
                emptyMessage="Fill in Daily Work to start building your history."
              />
            ) : (
              <DataTable
                columns={taskColumns}
                rows={data.completed}
                emptyTitle="Nothing closed in this range"
                emptyMessage="Approved tasks show up here with your leader's rating."
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
