import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import { logActivity } from "../utils/activity.js";

// Normalise any date input to midnight so one employee has one row per day.
const dayStart = (value) => {
  const d = value ? new Date(value) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const dayEnd = (value) => {
  const d = dayStart(value);
  d.setDate(d.getDate() + 1);
  return d;
};

/**
 * Whose attendance this panel is about.
 *
 * Both handlers below scope to this, and that is the point of it being one
 * constant: the sheet used to derive its people from a query and the summary
 * used to derive them from whatever records happened to exist, so the two
 * screens answered different questions and only one of them knew it.
 */
const ATTENDANCE_ROLES = ["employee", "operations_manager"];

const liveStaff = () =>
  User.find({ role: { $in: ATTENDANCE_ROLES }, status: "active" })
    .select("name email designation department role")
    .sort({ name: 1 });

// GET /api/admin/attendance?date=YYYY-MM-DD
// Returns every employee with that day's record (or a blank one).
export const getAttendanceSheet = async (req, res) => {
  try {
    const date = dayStart(req.query.date);

    const [employees, records] = await Promise.all([
      liveStaff(),
      Attendance.find({ date: { $gte: date, $lt: dayEnd(date) } }),
    ]);

    const byEmployee = records.reduce((acc, r) => {
      acc[String(r.employee)] = r;
      return acc;
    }, {});

    const items = employees.map((emp) => {
      const record = byEmployee[String(emp._id)];
      return {
        employee: {
          id: emp._id,
          name: emp.name,
          email: emp.email,
          designation: emp.designation,
          department: emp.department,
          role: emp.role,
        },
        status: record?.status || "",
        checkIn: record?.checkIn || "",
        checkOut: record?.checkOut || "",
        note: record?.note || "",
        marked: Boolean(record),
      };
    });

    const summary = items.reduce(
      (acc, item) => {
        if (item.status) acc[item.status] = (acc[item.status] || 0) + 1;
        else acc.unmarked += 1;
        return acc;
      },
      { present: 0, absent: 0, half_day: 0, leave: 0, unmarked: 0 }
    );

    return res.status(200).json({ date, items, summary });
  } catch (err) {
    console.error("getAttendanceSheet error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/admin/attendance  { date, entries: [{ employee, status, checkIn, checkOut, note }] }
export const saveAttendance = async (req, res) => {
  try {
    const { date, entries } = req.body;

    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ message: "No attendance entries provided" });
    }

    const day = dayStart(date);

    const operations = entries
      .filter((entry) => entry.employee && entry.status)
      .map((entry) => ({
        updateOne: {
          filter: { employee: entry.employee, date: day },
          update: {
            $set: {
              status: entry.status,
              note: entry.note || "",
              /**
               * Times are written only when the request actually carries them.
               *
               * The attendance sheet no longer collects in and out times, so
               * its entries arrive without those fields — and writing "" for a
               * field nobody sent would blank the times already recorded
               * against a day the moment somebody corrected a status on it.
               * An absent field means "leave it alone", which is also what any
               * other caller sending a partial entry would expect.
               */
              ...(entry.checkIn !== undefined ? { checkIn: entry.checkIn || "" } : {}),
              ...(entry.checkOut !== undefined ? { checkOut: entry.checkOut || "" } : {}),
            },
          },
          upsert: true,
        },
      }));

    if (!operations.length) {
      return res.status(400).json({ message: "No valid entries provided" });
    }

    await Attendance.bulkWrite(operations);

    logActivity(req, {
      action: "updated",
      entity: "Attendance",
      message: `Attendance saved for ${operations.length} staff on ${day.toDateString()}`,
    });

    return res.status(200).json({ message: "Attendance saved", saved: operations.length });
  } catch (err) {
    console.error("saveAttendance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/attendance/summary?month=YYYY-MM
export const getAttendanceSummary = async (req, res) => {
  try {
    const [year, month] = (req.query.month || "").split("-").map(Number);
    const base = year && month ? new Date(year, month - 1, 1) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

    /**
     * Scoped to the same people the daily sheet shows.
     *
     * Without this the summary counted every record in the range, including
     * those belonging to accounts that have since been deleted — and this
     * database holds a lot of them. Measured on the real data, the chart read
     * 64 marked days in July when 16 belonged to anybody still here, and 104
     * against 44 in August. HR saw a correct sheet of real people and then a
     * month view showing roughly double, with no way to tell which was wrong.
     *
     * Deriving the ids from the same query the sheet uses is what makes the
     * two screens agree by construction rather than by coincidence.
     */
    const staff = await User.find({
      role: { $in: ATTENDANCE_ROLES },
      status: "active",
    }).distinct("_id");

    // Records are stored at local midnight, so the day-of-month has to be read
    // back in local time too — $dayOfMonth would read them in UTC and shift
    // every date by one for timezones ahead of UTC.
    const records = await Attendance.find({
      employee: { $in: staff },
      date: { $gte: start, $lt: end },
    }).select("date status");

    const daily = {};
    records.forEach((record) => {
      const day = new Date(record.date).getDate();
      daily[day] = daily[day] || { day, present: 0, absent: 0, half_day: 0, leave: 0 };
      daily[day][record.status] = (daily[day][record.status] || 0) + 1;
    });

    return res.status(200).json({
      month: `${start.getFullYear()}-${start.getMonth() + 1}`,
      daily: Object.values(daily).sort((a, b) => a.day - b.day),
    });
  } catch (err) {
    console.error("getAttendanceSummary error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
