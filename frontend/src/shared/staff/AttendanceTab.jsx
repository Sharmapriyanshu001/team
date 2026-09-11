import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { Alert, Loader, Select } from "../components/ui";

/**
 * One person's month, as a calendar.
 *
 * The company-wide attendance sheet answers "who was in today". This answers
 * the other question — "what has this month looked like for them" — which is
 * the one somebody asks with the person's record already open, usually before
 * a conversation about turning up.
 *
 * WHY AN UNMARKED DAY IS NOT AN ABSENCE
 *
 * A day with no record means nobody filled the sheet in. That is not the same
 * as somebody not turning up, and a calendar that draws the two the same way
 * turns an admin's forgotten Tuesday into an accusation. Unmarked days are
 * left blank and counted separately.
 *
 * Weekends are drawn faintly rather than marked: this company has no stored
 * week pattern, so Sunday is only a guess about working days — shown as a hint
 * to read the grid by, never as a status.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** How each mark is drawn, and what it is called. */
const STATUS = {
  present: { label: "Present", cell: "bg-emerald-500 text-white", dot: "bg-emerald-500" },
  absent: { label: "Absent", cell: "bg-red-500 text-white", dot: "bg-red-500" },
  half_day: { label: "Half day", cell: "bg-amber-400 text-white", dot: "bg-amber-400" },
  leave: { label: "Leave", cell: "bg-blue-500 text-white", dot: "bg-blue-500" },
};

/** Five years back is as far as anybody has ever asked. */
const yearsAround = (current) =>
  Array.from({ length: 6 }, (_, i) => current + 1 - i).map((y) => ({ value: y, label: String(y) }));

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        {tone && <span className={`h-2 w-2 rounded-full ${tone}`} />}
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function AttendanceTab({ api, basePath, employeeId }) {
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!employeeId) return undefined;

    let active = true;
    setLoading(true);
    setError("");

    api
      .get(`${basePath}/staff/${employeeId}/attendance`, { params: { year, month } })
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) =>
          active && setError(err.response?.data?.message || "Could not load their attendance")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, employeeId, year, month]);

  /**
   * The month as a grid: blanks to push the 1st into its weekday column, then
   * one cell per day carrying whatever was marked against it.
   */
  const daysInMonth = data?.daysInMonth || 0;
  const byDay = {};
  (data?.days || []).forEach((entry) => {
    byDay[entry.day] = entry;
  });

  const cells = [
    ...Array.from({ length: data?.startsOn || 0 }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const counts = data?.counts || {};
  const unmarked = Math.max(0, daysInMonth - (data?.marked || 0));

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------ the filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <CalendarDays size={14} className="text-slate-400" />
          Showing
        </span>
        <Select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="w-36"
          options={MONTHS.map((name, i) => ({ value: i + 1, label: name }))}
          aria-label="Month"
        />
        <Select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-28"
          options={yearsAround(now.getFullYear())}
          aria-label="Year"
        />
      </div>

      <Alert>{error}</Alert>

      {loading ? (
        <Loader label="Reading the sheet…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Tile label="Present" value={counts.present || 0} tone={STATUS.present.dot} />
            <Tile label="Absent" value={counts.absent || 0} tone={STATUS.absent.dot} />
            <Tile label="Half day" value={counts.half_day || 0} tone={STATUS.half_day.dot} />
            <Tile label="Leave" value={counts.leave || 0} tone={STATUS.leave.dot} />
            {/* Not an absence — see the note at the top */}
            <Tile label="Not marked" value={unmarked} />
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((letter, i) => (
                <span
                  key={`${letter}-${i}`}
                  className="py-1 text-center text-[11px] font-medium text-slate-400"
                >
                  {letter}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, index) => {
                if (!day) return <span key={`pad-${index}`} />;

                const mark = byDay[day];
                const look = mark && STATUS[mark.status];
                const weekend = index % 7 === 0;

                return (
                  <span
                    key={day}
                    title={
                      mark
                        ? [
                            look?.label,
                            mark.checkIn && `in ${mark.checkIn}`,
                            mark.checkOut && `out ${mark.checkOut}`,
                            mark.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "Not marked"
                    }
                    className={`flex aspect-square items-center justify-center rounded-lg text-xs font-medium ring-1 ring-inset ${
                      look
                        ? `${look.cell} ring-transparent`
                        : weekend
                          ? "bg-slate-50 text-slate-300 ring-slate-100"
                          : "bg-white text-slate-400 ring-slate-200"
                    }`}
                  >
                    {day}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {Object.values(STATUS).map((entry) => (
              <span key={entry.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className={`h-2.5 w-2.5 rounded ${entry.dot}`} />
                {entry.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2.5 w-2.5 rounded bg-white ring-1 ring-inset ring-slate-200" />
              Not marked
            </span>
          </div>

          {data?.marked === 0 && (
            <p className="text-xs text-slate-400">
              Nothing was marked for {MONTHS[month - 1]} {year}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
