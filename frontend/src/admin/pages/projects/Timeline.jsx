import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, CalendarRange, CheckCircle2, Plus } from "lucide-react";

import adminApi from "../../adminApi";
import ProjectDetail from "../../components/ProjectDetail";
import Toolbar from "../../../shared/components/Toolbar";
import { STATUS_COLORS } from "../../../shared/theme";
import { prettify } from "../../../shared/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Loader,
  PageHeader,
} from "../../../shared/components/ui";

const MS_PER_DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUSES = ["planning", "in_progress", "on_hold", "completed", "cancelled"];

/**
 * The two fixed columns either side of the scrolling track.
 *
 * Kept as numbers so the month header and every bar row can share one grid
 * template. The previous layout padded the header by hand and let the bars sit
 * in a flex row, so the months drifted out of line with the bars they labelled
 * — a July bar could sit under the September heading.
 */
const LABEL_W = 244;
const META_W = 150;
const MONTH_W = 68; // narrowest a month can get before its label stops reading

const fmt = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

const fmtLong = (date) =>
  date
    ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Status colours are flat hex, and a bar needs two shades of the same colour:
// a pale channel for the whole run, the solid one for the part that is done.
const tint = (hex, alpha) => {
  const value = parseInt(String(hex).replace("#", ""), 16);
  if (Number.isNaN(value)) return hex;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

const isOverdue = (project) =>
  project.endDate &&
  new Date(project.endDate) < startOfDay(new Date()) &&
  !["completed", "cancelled"].includes(project.status);

/* ------------------------------------------------------------------ bits */

function Stat({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-500",
    blue: "bg-blue-50 text-blue-600",
    black: "bg-slate-900 text-white",
    red: "bg-red-50 text-red-600",
  };
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
        <p className="truncate text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      </div>
    </Card>
  );
}

/** Month bands and their dividing lines, drawn behind whatever sits on the track. */
function TrackGrid({ months }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {months.map((month, index) => (
        <div
          key={month.key}
          style={{ left: `${month.offset}%`, width: `${month.width}%` }}
          className={`absolute inset-y-0 ${index % 2 ? "bg-slate-50/70" : ""} ${
            index
              ? month.yearStart
                ? "border-l border-slate-300"
                : "border-l border-slate-100"
              : ""
          }`}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- the page */

export default function Timeline() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("start");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  const [reloads, setReloads] = useState(0);

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
  }, [status, reloads]);

  const changeStatus = (value) => {
    setLoading(true);
    setStatus(value);
  };

  // Search and sort run here rather than on the server: the whole window is
  // already loaded, and the bars are measured against each other anyway.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = needle
      ? projects.filter((p) =>
          [p.name, p.code, p.client?.company, p.client?.name, p.operationsManager?.name]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(needle))
        )
      : projects;

    const order = {
      start: (a, b) => new Date(a.startDate) - new Date(b.startDate),
      end: (a, b) => new Date(a.endDate) - new Date(b.endDate),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      progress: (a, b) => (b.progress || 0) - (a.progress || 0),
    };

    return [...matched].sort(order[sort] || order.start);
  }, [projects, search, sort]);

  const counts = useMemo(
    () => ({
      total: visible.length,
      running: visible.filter((p) => p.status === "in_progress").length,
      done: visible.filter((p) => p.status === "completed").length,
      late: visible.filter(isOverdue).length,
    }),
    [visible]
  );

  // Projects with dates, plus the overall window they span.
  const { rows, months, span, start } = useMemo(() => {
    const dated = visible.filter((p) => p.startDate && p.endDate);
    if (!dated.length) return { rows: [], months: [], span: 0, start: null };

    const min = new Date(Math.min(...dated.map((p) => new Date(p.startDate))));
    const max = new Date(Math.max(...dated.map((p) => new Date(p.endDate))));

    // Snap to whole months so the header reads cleanly
    const windowStart = new Date(min.getFullYear(), min.getMonth(), 1);
    const windowEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const totalDays = Math.max(1, (windowEnd - windowStart) / MS_PER_DAY);

    const labels = [];
    const cursor = new Date(windowStart);
    let used = 0;
    while (cursor <= windowEnd) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const visibleEnd = monthEnd > windowEnd ? windowEnd : monthEnd;
      const width = ((visibleEnd - cursor) / MS_PER_DAY / totalDays) * 100;
      labels.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        month: MONTHS[cursor.getMonth()],
        year: `'${String(cursor.getFullYear()).slice(2)}`,
        yearStart: cursor.getMonth() === 0,
        offset: used,
        width,
      });
      used += width;
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }

    const bars = dated.map((project) => {
      const from = new Date(project.startDate);
      const to = new Date(project.endDate);
      const offset = Math.max(0, ((from - windowStart) / MS_PER_DAY / totalDays) * 100);
      const width = Math.min(
        100 - offset,
        Math.max(1.2, ((to - from) / MS_PER_DAY / totalDays) * 100)
      );

      return {
        ...project,
        offset,
        width,
        // A label sitting past the end of a bar has to flip inwards near the
        // right edge, or the scroller clips it.
        flipLabel: offset + width > 86,
        days: Math.max(1, Math.round((to - from) / MS_PER_DAY)),
        overdue: isOverdue(project),
      };
    });

    return { rows: bars, months: labels, span: totalDays, start: windowStart };
  }, [visible]);

  // Position of "today" on the same scale
  const todayOffset = useMemo(() => {
    if (!start || !span) return null;
    const offset = ((new Date() - start) / MS_PER_DAY / span) * 100;
    return offset >= 0 && offset <= 100 ? offset : null;
  }, [start, span]);

  const undated = visible.length - rows.length;
  const gridTemplate = `${LABEL_W}px minmax(0, 1fr) ${META_W}px`;
  const boardWidth = LABEL_W + META_W + Math.max(560, months.length * MONTH_W);

  return (
    <div>
      <PageHeader
        title="Project Timeline"
        subtitle="Start and end dates plotted across the delivery window"
      >
        <Link to="/admin/projects">
          <Button variant="outline">All projects</Button>
        </Link>
        <Link to="/admin/projects/create">
          <Button>
            <Plus size={15} />
            Create Project
          </Button>
        </Link>
      </PageHeader>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={CalendarRange} label="Scheduled" value={counts.total} />
        <Stat icon={Activity} label="In progress" value={counts.running} tone="blue" />
        <Stat icon={CheckCircle2} label="Completed" value={counts.done} tone="black" />
        <Stat
          icon={AlertTriangle}
          label="Past deadline"
          value={counts.late}
          tone={counts.late ? "red" : "slate"}
        />
      </div>

      <Card>
        <Toolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by project, code, client or manager"
          onFilter={(key, value) => (key === "status" ? changeStatus(value) : setSort(value))}
          filters={[
            { key: "status", value: status, placeholder: "All statuses", options: STATUSES },
            {
              key: "sort",
              value: sort,
              options: [
                { value: "start", label: "Sort: start date" },
                { value: "end", label: "Sort: deadline" },
                { value: "progress", label: "Sort: progress" },
                { value: "name", label: "Sort: name" },
              ],
            },
          ]}
        />

        {loading ? (
          <Loader />
        ) : !rows.length ? (
          <EmptyState
            icon={CalendarRange}
            title={visible.length ? "Nothing to plot" : "Nothing scheduled"}
            message={
              visible.length
                ? "These projects have no start and end dates yet, so there is nothing to place on the timeline."
                : "Add start and end dates to your projects to see them on the timeline."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: boardWidth }}>
              {/* ---------------------------------------------- month header */}
              <div
                style={{ display: "grid", gridTemplateColumns: gridTemplate }}
                className="border-b border-slate-200 bg-white"
              >
                <div className="sticky left-0 z-20 flex items-end bg-white px-4 pb-2 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Project
                  </span>
                </div>

                <div className="relative pt-3">
                  <TrackGrid months={months} />
                  <div className="relative h-7">
                    {months.map((month) => (
                      <div
                        key={month.key}
                        style={{ left: `${month.offset}%`, width: `${month.width}%` }}
                        className="absolute inset-y-0 overflow-hidden pl-1.5"
                      >
                        {month.width > 3.2 && (
                          <p className="whitespace-nowrap text-[11px] font-semibold leading-tight text-slate-500">
                            {month.month}
                            <span className="ml-0.5 font-normal text-slate-400">{month.year}</span>
                          </p>
                        )}
                      </div>
                    ))}

                    {todayOffset !== null && (
                      <span
                        style={{ left: `${todayOffset}%` }}
                        className="absolute bottom-0 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue-600 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white"
                      >
                        Today
                      </span>
                    )}
                  </div>
                </div>

                <div className="sticky right-0 z-20 flex items-end justify-end bg-white px-4 pb-2 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Status
                  </span>
                </div>
              </div>

              {/* ----------------------------------------------------- rows */}
              {rows.map((project) => {
                const color = STATUS_COLORS[project.status] || STATUS_COLORS.in_progress;
                const done = Math.min(100, Math.max(0, project.progress || 0));

                return (
                  <div
                    key={project._id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewing(project)}
                    onKeyDown={(e) => e.key === "Enter" && setViewing(project)}
                    style={{ display: "grid", gridTemplateColumns: gridTemplate }}
                    className="group cursor-pointer border-b border-slate-100 outline-none last:border-0"
                  >
                    {/* name — sticky, so it stays readable while the track scrolls */}
                    <div className="sticky left-0 z-20 min-w-0 bg-white px-4 py-2.5 transition-colors group-hover:bg-blue-50 group-focus-visible:bg-blue-50">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                      </div>
                      <p className="mt-0.5 truncate pl-3.5 text-[11px] text-slate-400">
                        {project.client?.company || project.client?.name || "No client"}
                        {" · "}
                        {project.operationsManager?.name || "Unassigned"}
                        {" · "}
                        {project.days}d
                      </p>
                    </div>

                    {/* track */}
                    <div className="relative h-[60px] transition-colors group-hover:bg-blue-50 group-focus-visible:bg-blue-50">
                      <TrackGrid months={months} />

                      {todayOffset !== null && (
                        <div
                          style={{ left: `${todayOffset}%` }}
                          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-blue-500/60"
                        />
                      )}

                      <div
                        title={`${project.name}\n${fmtLong(project.startDate)} → ${fmtLong(
                          project.endDate
                        )}\n${project.days} days · ${done}% complete`}
                        style={{ left: `${project.offset}%`, width: `${project.width}%` }}
                        className="absolute top-1/2 z-[15] -translate-y-1/2"
                      >
                        <div
                          style={{
                            background: tint(color, 0.18),
                            boxShadow: `inset 0 0 0 1px ${tint(color, 0.45)}`,
                          }}
                          className="h-6 overflow-hidden rounded-md"
                        >
                          <div
                            style={{ width: `${done}%`, background: color }}
                            className="h-full rounded-md transition-all"
                          />
                        </div>

                        <span
                          className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-slate-500 ${
                            project.flipLabel ? "right-full mr-1.5" : "left-full ml-1.5"
                          }`}
                        >
                          {done}%
                        </span>
                      </div>
                    </div>

                    {/* status + dates */}
                    <div className="sticky right-0 z-20 bg-white px-4 py-2.5 text-right transition-colors group-hover:bg-blue-50 group-focus-visible:bg-blue-50">
                      <Badge value={project.status} />
                      <p
                        className={`mt-1 whitespace-nowrap text-[11px] ${
                          project.overdue ? "font-medium text-red-600" : "text-slate-400"
                        }`}
                      >
                        {project.overdue && <AlertTriangle size={11} className="mr-1 inline" />}
                        {fmt(project.startDate)} → {fmt(project.endDate)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- legend */}
        {!loading && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3">
            {STATUSES.map((key) => (
              <span key={key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: STATUS_COLORS[key] }}
                />
                {prettify(key)}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-3 w-px bg-blue-500" />
              Today
            </span>
            <span className="ml-auto text-[11px] text-slate-400">
              Solid fill shows progress · {rows.length} on the board
              {undated > 0 && ` · ${undated} without dates`}
            </span>
          </div>
        )}
      </Card>

      <ProjectDetail
        key={viewing?._id || "none"}
        open={Boolean(viewing)}
        id={viewing?._id}
        onClose={() => setViewing(null)}
        onEdit={(id) => navigate(`/admin/projects/create?id=${id}`)}
        onReview={() => navigate(`/admin/tasks/reviews?project=${viewing?._id}`)}
        onChanged={() => setReloads((n) => n + 1)}
      />
    </div>
  );
}
