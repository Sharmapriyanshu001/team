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
import { Save, CheckCheck } from "lucide-react";

import adminApi from "../../adminApi";
import { CHART, STATUS_COLORS, tooltipStyle } from "../../../shared/theme";
import { prettify } from "../../../shared/format";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Input,
  Loader,
  PageHeader,
  Select,
} from "../../../shared/components/ui";

const STATUSES = ["present", "absent", "half_day", "leave"];

const todayInput = () => new Date().toISOString().slice(0, 10);
const monthInput = () => new Date().toISOString().slice(0, 7);

const axisProps = { tick: { fill: CHART.grey, fontSize: 11 }, tickLine: false, axisLine: false };

export default function Attendance() {
  const [date, setDate] = useState(todayInput());
  const [month, setMonth] = useState(monthInput());

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [daily, setDaily] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Bumped after a save so both the sheet and the monthly chart refetch.
  const [reloadKey, setReloadKey] = useState(0);

  // `loading` is switched on by the date picker, off when the sheet arrives.
  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/attendance", { params: { date } })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setSummary(data.summary || {});
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load attendance");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [date, reloadKey]);

  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/attendance/summary", { params: { month } })
      .then(({ data }) => active && setDaily(data.daily || []))
      .catch(() => active && setDaily([]));

    return () => {
      active = false;
    };
  }, [month, reloadKey]);

  const changeDate = (value) => {
    setLoading(true);
    setDate(value);
  };

  const updateRow = (employeeId, patch) =>
    setRows((prev) =>
      prev.map((row) =>
        row.employee.id === employeeId ? { ...row, ...patch, marked: true } : row
      )
    );

  const markAllPresent = () =>
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        status: "present",
        checkIn: row.checkIn || "09:30",
        checkOut: row.checkOut || "18:30",
        marked: true,
      }))
    );

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const entries = rows
        .filter((row) => row.status)
        .map((row) => ({
          employee: row.employee.id,
          status: row.status,
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          note: row.note,
        }));

      if (!entries.length) {
        setError("Mark at least one person before saving");
        return;
      }

      const { data } = await adminApi.post("/admin/attendance", { date, entries });
      setSuccess(`Attendance saved for ${data.saved} staff`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Mark daily attendance and review the month at a glance">
        <Button variant="outline" onClick={markAllPresent}>
          <CheckCheck size={15} />
          Mark all present
        </Button>
        <Button loading={saving} onClick={handleSave}>
          <Save size={15} />
          Save
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {/* ------------------------------------------------- summary counters */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {["present", "absent", "half_day", "leave", "unmarked"].map((key) => (
          <Card key={key} className="p-4">
            <p className="text-xs font-medium text-slate-500">{prettify(key)}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{summary[key] ?? 0}</p>
            <span
              className="mt-2 block h-1 w-8 rounded-full"
              style={{ background: STATUS_COLORS[key] || CHART.greyLight }}
            />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* --------------------------------------------------- daily sheet */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Daily sheet"
            subtitle="Pick a date, set each person's status, then save"
            action={
              <Input
                type="date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="w-auto"
              />
            }
          />

          {loading ? (
            <Loader />
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Staff
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      In
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{row.employee.name}</p>
                        <p className="text-xs text-slate-400">
                          {row.employee.designation || prettify(row.employee.role)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={row.status}
                          placeholder="Not marked"
                          options={STATUSES}
                          onChange={(e) => updateRow(row.employee.id, { status: e.target.value })}
                          className="w-32"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Input
                          type="time"
                          value={row.checkIn}
                          onChange={(e) => updateRow(row.employee.id, { checkIn: e.target.value })}
                          className="w-28"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Input
                          type="time"
                          value={row.checkOut}
                          onChange={(e) => updateRow(row.employee.id, { checkOut: e.target.value })}
                          className="w-28"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------- monthly chart */}
        <Card>
          <CardHeader
            title="Monthly overview"
            action={
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-auto"
              />
            }
          />
          <div className="h-[480px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="day" {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} labelFormatter={(day) => `Day ${day}`} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => (
                    <span style={{ color: CHART.slate }}>{prettify(value)}</span>
                  )}
                />
                <Bar dataKey="present" stackId="a" fill={STATUS_COLORS.present} maxBarSize={18} />
                <Bar dataKey="half_day" stackId="a" fill={STATUS_COLORS.half_day} maxBarSize={18} />
                <Bar dataKey="leave" stackId="a" fill={STATUS_COLORS.leave} maxBarSize={18} />
                <Bar
                  dataKey="absent"
                  stackId="a"
                  fill={STATUS_COLORS.absent}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
