import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, KeyRound, UserCheck } from "lucide-react";

import hrApi from "../../hrApi";
import useHrAccess from "../../hooks/useHrAccess";
import useHiringLookups from "../../hooks/useHiringLookups";
import DataTable from "../../../shared/components/DataTable";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  ProgressBar,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import { dateInput, shortDate } from "../../../shared/hr/constants";

/**
 * The last stretch: from "we have selected them" to "they work here".
 *
 * The checklist is chased over days and the account is created once at the
 * end, which is why this is a screen of its own rather than a button on the
 * candidate. Onboarding is complete when there is a login — not when the last
 * box is ticked — so the tick boxes are a record of what was chased, and
 * Complete Onboarding is the thing that actually makes somebody an employee.
 */

export default function Onboarding() {
  const { can } = useHrAccess();
  const { staffOptions } = useHiringLookups();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Completing it — the step that creates the account
  const [hiring, setHiring] = useState(null);
  const [hireForm, setHireForm] = useState({ password: "" });
  const [hired, setHired] = useState(null);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/hiring/onboarding")
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load onboarding"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const openEdit = (row) => {
    if (!can("hiring", "edit") || row.complete) return;

    setEditing(row);
    setForm({
      joiningDate: dateInput(row.onboarding?.joiningDate),
      designation: row.onboarding?.designation || row.position || "",
      department: row.onboarding?.department || row.department || "",
      reportsTo: row.onboarding?.reportsTo?._id || row.onboarding?.reportsTo || "",
      notes: row.onboarding?.notes || "",
      checklist: (row.onboarding?.checklist || []).map((item) => ({
        label: item.label,
        done: Boolean(item.done),
      })),
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await hrApi.put(`/hr/hiring/onboarding/${editing._id}`, form);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this onboarding");
    } finally {
      setSaving(false);
    }
  };

  const complete = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const { data: body } = await hrApi.post(`/hr/candidates/${hiring._id}/hire`, hireForm);
      setHiring(null);
      // Shown once — what is stored is a one-way hash and cannot be read back
      setHired(body);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not complete onboarding");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Joining",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.email || row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "As",
      render: (row) => (
        <div>
          <p className="text-slate-700">
            {row.onboarding?.designation || row.position || "—"}
          </p>
          <p className="text-xs text-slate-400">
            {row.jobOpening ? `${row.jobOpening.code || ""} ${row.jobOpening.title}`.trim() : "No opening"}
          </p>
        </div>
      ),
    },
    {
      key: "joiningDate",
      header: "Starts",
      render: (row) =>
        row.onboarding?.joiningDate ? (
          shortDate(row.onboarding.joiningDate)
        ) : (
          <span className="text-amber-600">Not agreed</span>
        ),
    },
    {
      key: "progress",
      header: "Checklist",
      render: (row) => (
        <div className="flex items-center gap-2">
          <ProgressBar value={row.progress} />
          <span className="text-xs text-slate-500">
            {row.checklistDone}/{row.checklistTotal}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.complete ? (
          <div>
            <Badge tone="black">Employee</Badge>
            <p className="mt-1 text-[11px] text-slate-400">{shortDate(row.hiredAt)}</p>
          </div>
        ) : (
          <Badge tone="blue">Onboarding</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        if (row.complete) {
          return <span className="text-[11px] text-slate-400">{row.hiredUser?.email}</span>;
        }
        if (!can("hiring", "create")) return null;

        return (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              setHiring(row);
              setHireForm({ password: "" });
              setFormError("");
            }}
          >
            <UserCheck size={14} />
            Complete
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle={
          data
            ? `${data.inProgress} in progress · ${data.completed} became employees`
            : "From selected to employed"
        }
      />

      <Alert>{error}</Alert>

      <Card>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          onRowClick={openEdit}
          emptyTitle="Nobody onboarding"
          emptyMessage="Move a candidate to Selected and their onboarding opens here."
        />
      </Card>

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <ClipboardCheck size={13} className="mt-0.5 shrink-0" />
        Completing onboarding creates the person's login and makes them an employee — it is the
        last step of the chain, and the only thing that marks a candidate hired.
      </p>

      {/* --------------------------------------------------- the checklist */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Onboarding"
        subtitle={editing ? `${editing.name}${editing.position ? ` · ${editing.position}` : ""}` : ""}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <Alert>{formError}</Alert>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Joining date">
              <Input
                type="date"
                value={form.joiningDate || ""}
                onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
              />
            </Field>
            <Field label="Designation">
              <Input
                value={form.designation || ""}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department">
              <Input
                value={form.department || ""}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="Reports to">
              <Select
                value={form.reportsTo || ""}
                onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}
                options={staffOptions}
                placeholder="Not decided"
              />
            </Field>
          </div>

          <Field label="Checklist" hint="Who ticked each box, and when, is recorded">
            <div className="space-y-1.5 rounded-lg border border-slate-200 p-3">
              {(form.checklist || []).map((item, index) => (
                <label
                  key={item.label}
                  className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => {
                      const next = [...form.checklist];
                      next[index] = { ...item, done: e.target.checked };
                      setForm({ ...form, checklist: next });
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span className={item.done ? "text-slate-400 line-through" : ""}>
                    {item.label}
                  </span>
                </label>
              ))}
              {!form.checklist?.length && (
                <p className="text-xs text-slate-400">No checklist on this one.</p>
              )}
            </div>
          </Field>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </form>
      </Modal>

      {/* ------------------------------------------------- create the login */}
      <Modal
        open={Boolean(hiring)}
        onClose={() => setHiring(null)}
        title="Complete onboarding"
        subtitle={hiring ? `${hiring.name} becomes an employee with a login` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setHiring(null)}>
              Cancel
            </Button>
            <Button onClick={complete} loading={saving}>
              Complete
            </Button>
          </>
        }
      >
        <form onSubmit={complete} className="space-y-3">
          <Alert>{formError}</Alert>

          <Alert tone="success">
            Their account will be created with the joining date, designation and reporting line
            from the checklist above. The candidate record is kept and linked, so where this hire
            came from stays on record.
          </Alert>

          {hiring && !hiring.onboarding?.joiningDate && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
              No joining date has been agreed — today's date will be used. Set one first if that is
              not right.
            </p>
          )}

          <Field
            label="Password"
            hint={`Leave blank to use their mobile number${hiring?.phone ? ` (${hiring.phone})` : ""}`}
          >
            <Input
              value={hireForm.password}
              onChange={(e) => setHireForm({ ...hireForm, password: e.target.value })}
              placeholder="Optional"
            />
          </Field>
        </form>
      </Modal>

      {/* ------------------------------------------------------ the login */}
      <Modal
        open={Boolean(hired)}
        onClose={() => setHired(null)}
        title="They are an employee now"
        subtitle="Pass these on — the password cannot be read back afterwards"
        size="sm"
        footer={<Button onClick={() => setHired(null)}>Done</Button>}
      >
        <div className="space-y-3">
          <Alert tone="success">{hired?.message}</Alert>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Login ID
            </p>
            <p className="mb-3 font-mono text-sm text-slate-900">{hired?.credentials?.loginId}</p>

            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Password
            </p>
            <p className="font-mono text-sm text-slate-900">{hired?.credentials?.password}</p>
          </div>

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <KeyRound size={13} className="mt-0.5 shrink-0" />
            They sign in at the employee panel and can change this from their own profile. If this
            was the last seat on the opening, the vacancy has closed itself.
          </p>

          <p className="flex items-start gap-2 text-xs text-emerald-700">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            They now appear under Employees.
          </p>
        </div>
      </Modal>
    </div>
  );
}
