import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import adminApi from "../../adminApi";
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

export default function TeamLeaderPerformance() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi
      .get("/admin/team-leaders/performance")
      .then(({ data }) => setItems(data.items || []))
      .catch((err) => setError(err.response?.data?.message || "Could not load performance"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  const chartData = items.map((item) => ({
    name: item.name.split(" ")[0],
    Projects: item.projects,
    Completed: item.projectsCompleted,
    Score: item.score,
  }));

  const columns = [
    {
      key: "name",
      header: "Team leader",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.designation || row.department || "—"}</p>
        </div>
      ),
    },
    { key: "teamSize", header: "Team size" },
    {
      key: "projects",
      header: "Projects",
      render: (row) => `${row.projectsCompleted} / ${row.projects}`,
    },
    {
      key: "avgProgress",
      header: "Avg progress",
      render: (row) => <ProgressBar value={row.avgProgress} />,
    },
    {
      key: "tasks",
      header: "Tasks done",
      render: (row) => `${row.tasksCompleted} / ${row.tasks}`,
    },
    {
      key: "taskCompletionRate",
      header: "Task rate",
      render: (row) => `${row.taskCompletionRate}%`,
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
        title="Team Leader Performance"
        subtitle="Projects delivered, team size and task completion for each leader"
      />

      <Alert>{error}</Alert>

      <Card className="mb-4">
        <CardHeader title="Projects vs delivery" subtitle="Total projects, completed projects and overall score" />
        <div className="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="Projects" fill={CHART.blueLight} radius={[6, 6, 0, 0]} maxBarSize={30} />
              <Bar dataKey="Completed" fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={30} />
              <Bar dataKey="Score" fill={CHART.black} radius={[6, 6, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardHeader title="Detailed breakdown" />
        <DataTable
          columns={columns}
          rows={items}
          emptyTitle="No team leaders yet"
          emptyMessage="Add team leaders to start tracking their delivery."
        />
      </Card>
    </div>
  );
}
