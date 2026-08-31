import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

import { CHART } from "../theme";
import { prettify } from "../format";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Loader, PageHeader } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const KIND_COLORS = {
  task: CHART.blue,
  project_start: CHART.blueLight,
  project_end: CHART.black,
};

const toMonthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/**
 * Month grid of task deadlines and project milestones, shared by the leader
 * and employee panels. `taskLinkBase` (optional) turns task events in the day
 * list into links, e.g. "/employee/tasks/details".
 */
export default function CalendarPanel({ api, base, title, subtitle, taskLinkBase }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [events, setEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/calendar`, { params: { month: toMonthKey(cursor) } })
      .then(({ data }) => active && setEvents(data.events || []))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the calendar");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base, cursor]);

  const changeMonth = (delta) => {
    setLoading(true);
    setSelectedDay(1);
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const byDay = useMemo(
    () =>
      events.reduce((acc, event) => {
        const day = new Date(event.date).getDate();
        (acc[day] = acc[day] || []).push(event);
        return acc;
      }, {}),
    [events]
  );

  // Monday-first grid, padded to whole weeks
  const cells = useMemo(() => {
    const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const lead = (firstDay.getDay() + 6) % 7;

    const list = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) list.push(day);
    while (list.length % 7 !== 0) list.push(null);

    return list;
  }, [cursor]);

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === cursor.getFullYear() && today.getMonth() === cursor.getMonth();

  const dayEvents = byDay[selectedDay] || [];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => changeMonth(-1)}>
            <ChevronLeft size={15} />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-slate-800">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </span>
          <Button variant="outline" size="sm" onClick={() => changeMonth(1)}>
            <ChevronRight size={15} />
          </Button>
        </div>
      </PageHeader>

      <Alert>{error}</Alert>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            title="Month view"
            subtitle={`${events.length} events this month`}
            action={
              <div className="flex flex-wrap gap-3">
                {[
                  ["Task due", KIND_COLORS.task],
                  ["Project start", KIND_COLORS.project_start],
                  ["Deadline", KIND_COLORS.project_end],
                ].map(([label, color]) => (
                  <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            }
          />

          {loading ? (
            <Loader />
          ) : (
            <div className="p-4">
              <div className="mb-2 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, index) => {
                  if (!day) return <div key={`pad-${index}`} className="min-h-[92px] rounded-lg" />;

                  const items = byDay[day] || [];
                  const isToday = isCurrentMonth && day === today.getDate();
                  const isSelected = day === selectedDay;

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(day)}
                      className={`min-h-[92px] rounded-lg border p-1.5 text-left transition-colors ${
                        isSelected
                          ? "border-blue-600 bg-blue-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                          isToday ? "bg-slate-900 text-white" : "text-slate-600"
                        }`}
                      >
                        {day}
                      </span>

                      <div className="mt-1 space-y-0.5">
                        {items.slice(0, 2).map((event) => (
                          <div
                            key={event.id}
                            className="truncate rounded px-1 py-0.5 text-[10px] text-white"
                            style={{ background: KIND_COLORS[event.kind] }}
                            title={event.title}
                          >
                            {event.title}
                          </div>
                        ))}
                        {items.length > 2 && (
                          <p className="px-1 text-[10px] font-medium text-slate-500">
                            +{items.length - 2} more
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------ day list */}
        <Card>
          <CardHeader
            title={`${MONTHS[cursor.getMonth()]} ${selectedDay}`}
            subtitle={`${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`}
          />
          <div className="divide-y divide-slate-100">
            {!dayEvents.length && (
              <EmptyState
                icon={CalendarDays}
                title="Nothing on this day"
                message="Pick another date from the grid."
              />
            )}
            {dayEvents.map((event) => {
              const body = (
                <div className="flex gap-3 px-5 py-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: KIND_COLORS[event.kind] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{event.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {event.subtitle}
                      {event.context ? ` · ${event.context}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone="slate">{prettify(event.kind)}</Badge>
                      {event.status && <Badge value={event.status} />}
                      {event.priority && <Badge value={event.priority} />}
                    </div>
                  </div>
                </div>
              );

              return taskLinkBase && event.taskId ? (
                <Link
                  key={event.id}
                  to={`${taskLinkBase}?id=${event.taskId}`}
                  className="block hover:bg-slate-50"
                >
                  {body}
                </Link>
              ) : (
                <div key={event.id}>{body}</div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
