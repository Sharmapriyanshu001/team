import { useEffect, useState } from "react";
import { Gauge, AlertTriangle, CalendarDays } from "lucide-react";

import clientApi from "../clientApi";
import { STATUS_COLORS } from "../../shared/theme";
import { prettify, initialsOf, money } from "../../shared/format";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");
const timeLabel = (item) => {
  if (item.daysLeft === null) return "No target date";
  if (item.status === "completed") return "Delivered";
  if (item.daysLeft < 0) return `${Math.abs(item.daysLeft)} days past target`;
  if (item.daysLeft === 0) return "Target is today";
  return `${item.daysLeft} days to target`;
};

export default function ProjectProgress() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    clientApi
      .get("/client/progress")
      .then(({ data }) => active && setItems(data.items || []))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the progress board");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Project Progress"
        subtitle="Reported by the team leading each project"
      />

      <Alert>{error}</Alert>

      {!items.length ? (
        <Card>
          <EmptyState
            icon={Gauge}
            title="Nothing to show yet"
            message="Once a project is booked under your account it will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader
                title={item.name}
                subtitle={item.code || "No code"}
                action={
                  <div className="flex items-center gap-2">
                    <Badge value={item.priority} />
                    <Badge value={item.status} />
                  </div>
                }
              />

              <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_300px]">
                <div>
                  {item.description && (
                    <p className="mb-4 text-sm text-slate-600">{item.description}</p>
                  )}

                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-500">Overall progress</span>
                    <span className="text-lg font-bold text-slate-900">{item.progress}%</span>
                  </div>

                  {/* Straight bar rather than an editable slider — read only here */}
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${item.progress}%`,
                        background: STATUS_COLORS[item.status] || STATUS_COLORS.in_progress,
                      }}
                    />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                      ["Work items", `${item.tasksCompleted} / ${item.tasks}`],
                      ["Delivery", `${item.taskProgress}%`],
                      ["Started", fmt(item.startDate)],
                      ["Target", fmt(item.endDate)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">
                          {label}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <ProgressBar value={item.taskProgress} />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Work items closed by the team
                    </p>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg bg-slate-50 p-4">
                  <div
                    className={`flex items-center gap-2 text-xs font-medium ${
                      item.overdue ? "text-red-600" : "text-slate-600"
                    }`}
                  >
                    <CalendarDays size={14} />
                    {timeLabel(item)}
                  </div>

                  {item.openIssues > 0 && (
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                      <AlertTriangle size={14} />
                      {item.openIssues} open {item.openIssues === 1 ? "issue" : "issues"} being
                      worked on
                    </div>
                  )}

                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Project lead
                    </p>
                    {item.teamLeader ? (
                      <div className="mt-2 flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                          {initialsOf(item.teamLeader.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {item.teamLeader.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {item.teamLeader.designation || "Project lead"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">To be assigned</p>
                    )}
                  </div>

                  <dl className="space-y-1.5 border-t border-slate-200 pt-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Team size</dt>
                      <dd className="font-medium text-slate-800">{item.teamSize}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Contract value</dt>
                      <dd className="font-medium text-slate-800">{money(item.budget)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Stage</dt>
                      <dd className="font-medium text-slate-800">{prettify(item.status)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
