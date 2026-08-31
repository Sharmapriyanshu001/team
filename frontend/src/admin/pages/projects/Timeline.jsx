import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";

import adminApi from "../../adminApi";
import { STATUS_COLORS } from "../../../shared/theme";
import { prettify } from "../../../shared/format";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  Select,
} from "../../../shared/components/ui";

const MS_PER_DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

export default function Timeline() {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // `loading` is flipped on by the status filter handler, off when data lands.
  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/projects", { params: { limit: 200, status: status || undefined } })
      .then(({ data }) => active && setProjects(data.items || []))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the timeline");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [status]);

  const changeStatus = (value) => {
    setLoading(true);
    setStatus(value);
  };

  // Projects with dates, plus the overall window they span.
  const { rows, months, span, start } = useMemo(() => {
    const dated = projects.filter((p) => p.startDate && p.endDate);
    if (!dated.length) return { rows: [], months: [], span: 0, start: null };

    const min = new Date(Math.min(...dated.map((p) => new Date(p.startDate))));
    const max = new Date(Math.max(...dated.map((p) => new Date(p.endDate))));

    // Snap to whole months so the header reads cleanly
    const windowStart = new Date(min.getFullYear(), min.getMonth(), 1);
    const windowEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const totalDays = Math.max(1, (windowEnd - windowStart) / MS_PER_DAY);

    const labels = [];
    const cursor = new Date(windowStart);
    while (cursor <= windowEnd) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const visibleEnd = monthEnd > windowEnd ? windowEnd : monthEnd;
      labels.push({
        label: `${MONTHS[cursor.getMonth()]} '${String(cursor.getFullYear()).slice(2)}`,
        width: ((visibleEnd - cursor) / MS_PER_DAY / totalDays) * 100,
      });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }

    const bars = dated.map((project) => {
      const from = new Date(project.startDate);
      const to = new Date(project.endDate);
      return {
        ...project,
        offset: Math.max(0, ((from - windowStart) / MS_PER_DAY / totalDays) * 100),
        width: Math.max(1.5, ((to - from) / MS_PER_DAY / totalDays) * 100),
        days: Math.round((to - from) / MS_PER_DAY),
      };
    });

    return { rows: bars, months: labels, span: totalDays, start: windowStart };
  }, [projects]);

  // Position of "today" on the same scale
  const todayOffset = useMemo(() => {
    if (!start || !span) return null;
    const offset = ((new Date() - start) / MS_PER_DAY / span) * 100;
    return offset >= 0 && offset <= 100 ? offset : null;
  }, [start, span]);

  return (
    <div>
      <PageHeader title="Project Timeline" subtitle="Start and end dates plotted across the delivery window">
        <Select
          value={status}
          onChange={(e) => changeStatus(e.target.value)}
          placeholder="All statuses"
          options={["planning", "in_progress", "on_hold", "completed", "cancelled"]}
          className="w-auto"
        />
      </PageHeader>

      <Alert>{error}</Alert>

      <Card>
        <CardHeader
          title="Delivery schedule"
          subtitle={rows.length ? `${rows.length} scheduled projects` : undefined}
        />

        {loading ? (
          <Loader />
        ) : !rows.length ? (
          <EmptyState
            icon={CalendarRange}
            title="Nothing scheduled"
            message="Add start and end dates to your projects to see them on the timeline."
          />
        ) : (
          <div className="overflow-x-auto p-5">
            <div className="min-w-[760px]">
              {/* Month header */}
              <div className="mb-3 flex border-b border-slate-200 pb-2 pl-56">
                {months.map((month) => (
                  <div
                    key={month.label}
                    style={{ width: `${month.width}%` }}
                    className="shrink-0 border-l border-slate-100 pl-2 text-[11px] font-medium text-slate-400"
                  >
                    {month.label}
                  </div>
                ))}
              </div>

              {/* Bars */}
              <div className="relative space-y-2">
                {todayOffset !== null && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-10 w-px bg-blue-600/40"
                    style={{ left: `calc(14rem + ${todayOffset}% * (100% - 14rem) / 100)` }}
                  />
                )}

                {rows.map((project) => (
                  <div key={project._id} className="flex items-center gap-3">
                    <div className="w-56 shrink-0 pr-2">
                      <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {project.teamLeader?.name || "Unassigned"} · {project.days}d
                      </p>
                    </div>

                    <div className="relative h-8 flex-1 rounded-md bg-slate-50">
                      <div
                        title={`${fmt(project.startDate)} → ${fmt(project.endDate)}`}
                        style={{
                          marginLeft: `${project.offset}%`,
                          width: `${project.width}%`,
                          background: STATUS_COLORS[project.status] || STATUS_COLORS.in_progress,
                        }}
                        className="group relative flex h-full items-center overflow-hidden rounded-md px-2 transition-opacity hover:opacity-90"
                      >
                        {/* Progress shading inside the bar */}
                        <span
                          className="absolute inset-y-0 left-0 bg-white/25"
                          style={{ width: `${100 - project.progress}%`, right: 0, left: "auto" }}
                        />
                        <span className="relative truncate text-[11px] font-medium text-white">
                          {project.progress}%
                        </span>
                      </div>
                    </div>

                    <div className="w-40 shrink-0 text-right">
                      <Badge value={project.status} />
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {fmt(project.startDate)} → {fmt(project.endDate)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="mt-6 flex flex-wrap gap-4 border-t border-slate-100 pt-4">
                {["planning", "in_progress", "on_hold", "completed", "cancelled"].map((key) => (
                  <span key={key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: STATUS_COLORS[key] }}
                    />
                    {prettify(key)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
