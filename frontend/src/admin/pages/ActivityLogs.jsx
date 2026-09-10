import { useMemo } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  History,
  LogIn,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { useCrud } from "../hooks/crud";
import { initialsOf } from "../../shared/format";
import { Alert, Badge, Card, EmptyState, Loader, PageHeader, Select } from "../../shared/components/ui";

const ENTITIES = [
  "Client",
  "Project",
  "Task",
  "Issue",
  "Employee",
  "Operations Manager",
  "File",
  "Role",
  "Settings",
  "Admin",
];

/**
 * What each kind of entry looks like on the rail.
 *
 * A log where every line is the same grey sentence is a log nobody reads —
 * the eye has nothing to skip to. A delete and a login are the two things
 * somebody scanning this page is actually looking for, so they are the two
 * that stand out: red and black against the blue of ordinary work.
 */
const ACTIONS = {
  created: { label: "Created", icon: Plus, dot: "bg-blue-600", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  updated: { label: "Updated", icon: Pencil, dot: "bg-sky-400", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  deleted: { label: "Deleted", icon: Trash2, dot: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200" },
  login: { label: "Login", icon: LogIn, dot: "bg-slate-900", chip: "bg-slate-900 text-white ring-slate-900" },
};

const FALLBACK = { label: "Activity", icon: Activity, dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700 ring-slate-200" };

const shapeOf = (action) => ACTIONS[action] || FALLBACK;

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", then the date itself — nobody reads a date they know. */
const dayLabel = (value) => {
  const today = startOfDay(new Date());
  const day = startOfDay(value);
  const gap = Math.round((today - day) / 86400000);

  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  return new Date(value).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: startOfDay(new Date()) - day > 300 * 86400000 ? "numeric" : undefined,
  });
};

const clockOf = (value) =>
  new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Fresh entries read better as "12 min ago" than as a wall-clock time. */
const agoOf = (value) => {
  const seconds = Math.round((Date.now() - new Date(value)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 21600) return `${Math.floor(seconds / 3600)} h ago`;
  return null;
};

export default function ActivityLogs() {
  const crud = useCrud("activity-logs", { limit: 50 });

  // The feed reads by day. Rows arrive newest first, so one pass is enough.
  const days = useMemo(() => {
    const groups = [];
    crud.rows.forEach((row) => {
      const key = startOfDay(row.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(row);
      else groups.push({ key, label: dayLabel(row.createdAt), items: [row] });
    });
    return groups;
  }, [crud.rows]);

  const activeAction = crud.filters.action || "";

  return (
    <div>
      <PageHeader
        title="Activity Logs"
        subtitle="Every create, update, delete and sign-in recorded across the panel"
      >
        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
          {crud.total.toLocaleString("en-IN")} recorded
        </span>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        {/* ------------------------------------------------------- filters */}
        <div className="space-y-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={crud.search}
                onChange={(e) => crud.setSearch(e.target.value)}
                placeholder="Search by what happened, or who did it"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <Select
              value={crud.filters.entity ?? ""}
              onChange={(e) => crud.setFilter("entity", e.target.value)}
              options={ENTITIES}
              placeholder="All modules"
              className="w-auto min-w-[150px]"
            />
          </div>

          {/**
           * Actions as chips rather than a dropdown: there are four of them,
           * they are the filter people actually reach for, and one click beats
           * open-scan-pick every time.
           */}
          <div className="flex flex-wrap gap-1.5">
            {[["", "Everything"], ...Object.entries(ACTIONS).map(([key, a]) => [key, a.label])].map(
              ([key, label]) => {
                const on = activeAction === key;
                return (
                  <button
                    key={key || "all"}
                    onClick={() => crud.setFilter("action", key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      on
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- feed */}
        {crud.loading ? (
          <Loader label="Reading the log…" />
        ) : !crud.rows.length ? (
          <EmptyState
            icon={History}
            title="Nothing matches"
            message="Every create, update and delete in the panel is recorded here. Widen the filters to see more."
          />
        ) : (
          <div>
            {days.map((day) => (
              <section key={day.key}>
                <div className="flex items-center gap-3 border-y border-slate-100 bg-slate-50/70 px-4 py-2 first:border-t-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {day.label}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {day.items.length} {day.items.length === 1 ? "entry" : "entries"}
                  </span>
                </div>

                <ul className="px-4">
                  {day.items.map((row, index) => {
                    const shape = shapeOf(row.action);
                    const Icon = shape.icon;
                    const ago = agoOf(row.createdAt);

                    return (
                      <li key={row._id} className="relative flex gap-3 py-3 pl-1">
                        {/* the rail — a continuous line, broken after the last item */}
                        {index < day.items.length - 1 && (
                          <span className="absolute bottom-0 left-[19px] top-9 w-px bg-slate-200" />
                        )}

                        <span
                          className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-white ${shape.dot}`}
                        >
                          <Icon size={13} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800">
                            {row.message || `${shape.label} ${row.entity || "a record"}`}
                          </p>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[8px] font-bold text-slate-600">
                                {initialsOf(row.actorName || "System")}
                              </span>
                              <span className="font-medium text-slate-600">
                                {row.actorName || "System"}
                              </span>
                            </span>

                            {row.entity && (
                              <>
                                <span className="text-slate-300">·</span>
                                <Badge tone="slate">{row.entity}</Badge>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${shape.chip}`}
                          >
                            {shape.label}
                          </span>
                          <p
                            className="mt-1 whitespace-nowrap text-[11px] text-slate-400"
                            title={new Date(row.createdAt).toLocaleString("en-IN")}
                          >
                            {ago || clockOf(row.createdAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            {crud.pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                <span>
                  Page {crud.page} of {crud.pages} · {crud.total.toLocaleString("en-IN")} entries
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => crud.setPage(crud.page - 1)}
                    disabled={crud.page <= 1}
                    className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => crud.setPage(crud.page + 1)}
                    disabled={crud.page >= crud.pages}
                    className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
