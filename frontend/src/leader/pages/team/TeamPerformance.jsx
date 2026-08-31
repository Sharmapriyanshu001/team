import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import leaderApi from "../../leaderApi";
import DataTable from "../../../shared/components/DataTable";
import { CHART, tooltipStyle } from "../../../shared/theme";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../../shared/components/ui";

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

const scoreTone = (score) => (score >= 70 ? "blue" : score >= 40 ? "sky" : "slate");

export default function TeamPerformance() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/team/performance")
      .then(({ data }) => active && setItems(data.items || []))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load performance");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
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
      header: "Member",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.designation || "—"}</p>
        </div>
      ),
    },
    {
      key: "tasks",
      header: "Tasks",
      render: (row) => `${row.tasksCompleted} / ${row.tasks}`,
    },
    {
      key: "tasksInReview",
      header: "In review",
      render: (row) => row.tasksInReview || "—",
    },
    {
      key: "overdue",
      header: "Overdue",
      render: (row) =>
        row.overdue ? <span className="font-medium text-red-600">{row.overdue}</span> : "—",
    },
    {
      key: "completionRate",
      header: "Completion",
      render: (row) => <ProgressBar value={row.completionRate} />,
    },
    { key: "attendanceRate", header: "Attendance", render: (row) => `${row.attendanceRate}%` },
    { key: "rating", header: "Rating", render: (row) => (row.rating ? `${row.rating} / 5` : "—") },
    {
      key: "score",
      header: "Score",
      render: (row) => <Badge tone={scoreTone(row.score)}>{row.score}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Team Performance"
        subtitle="Delivery and attendance for the people reporting to you"
      />

      <Alert>{error}</Alert>

      <Card className="mb-4">
        <CardHeader
          title="Workload vs attendance"
          subtitle="Bars show task counts, the line shows attendance for this month"
        />
        <div className="h-80 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="name" {...axisProps} interval={0} />
              <YAxis yAxisId="left" {...axisProps} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, 100]} unit="%" />
              <Tooltip {...tooltipStyle} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="Completed" stackId="t" fill={CHART.blue} maxBarSize={34} />
              <Bar
                yAxisId="left"
                dataKey="Pending"
                stackId="t"
                fill={CHART.bluePale}
                radius={[6, 6, 0, 0]}
                maxBarSize={34}
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
          emptyTitle="No team members yet"
          emptyMessage="Once employees report to you their performance shows up here."
        />
      </Card>
    </div>
  );
}
