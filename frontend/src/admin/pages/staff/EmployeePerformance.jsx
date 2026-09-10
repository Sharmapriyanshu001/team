import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import { CHART, tooltipStyle } from "../../../shared/theme";
import { Alert, Badge, Card, CardHeader, Loader, PageHeader, ProgressBar } from "../../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const scoreTone = (score) => (score >= 70 ? "blue" : score >= 40 ? "sky" : "slate");

export default function EmployeePerformance() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi
      .get("/admin/employees/performance")
      .then(({ data }) => setItems(data.items || []))
      .catch((err) => setError(err.response?.data?.message || "Could not load performance"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  const chartData = items.map((item) => ({
    name: item.name.split(" ")[0],
    Completed: item.tasksCompleted,
    Pending: item.tasksPending,
    "Attendance %": item.attendanceRate,
  }));

  const columns = [
    {
      key: "name",
      header: "Employee",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.designation || "—"}</p>
        </div>
      ),
    },
    { key: "operationsManager", header: "Operations Manager" },
    { key: "department", header: "Department", render: (row) => row.department || "—" },
    {
      key: "tasks",
      header: "Tasks",
      render: (row) => `${row.tasksCompleted} done · ${row.tasksPending} open`,
    },
    {
      key: "completionRate",
      header: "Completion",
      render: (row) => <ProgressBar value={row.completionRate} />,
    },
    {
      key: "attendanceRate",
      header: "Attendance",
      render: (row) => `${row.attendanceRate}%`,
    },
    {
      key: "rating",
      header: "Rating",
      render: (row) => (row.rating ? `${row.rating} / 5` : "—"),
    },
    {
      key: "score",
      header: "Score",
      render: (row) => <Badge tone={scoreTone(row.score)}>{row.score}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Employee Performance"
        subtitle="Task delivery and attendance for the current month"
      />

      <Alert>{error}</Alert>

      <Card className="mb-4">
        <CardHeader
          title="Workload vs attendance"
          subtitle="Bars show task counts, the line shows attendance percentage"
        />
        <div className="h-80 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={56} />
              <YAxis yAxisId="left" {...axisProps} allowDecimals={false} />
              <YAxis
                yAxisId="right"
                orientation="right"
                {...axisProps}
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip {...tooltipStyle} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="Completed" stackId="t" fill={CHART.blue} maxBarSize={30} />
              <Bar
                yAxisId="left"
                dataKey="Pending"
                stackId="t"
                fill={CHART.bluePale}
                radius={[6, 6, 0, 0]}
                maxBarSize={30}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Attendance %"
                stroke={CHART.black}
                strokeWidth={2}
                dot={{ r: 3, fill: CHART.black }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardHeader title="Detailed breakdown" />
        <DataTable
          columns={columns}
          rows={items}
          emptyTitle="No employees yet"
          emptyMessage="Add employees and assign them tasks to see performance here."
        />
      </Card>
    </div>
  );
}
