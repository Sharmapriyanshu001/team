import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power, Trash2 } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TagField,
  Textarea,
} from "../../shared/components/ui";

/**
 * Sales logins, opened and closed from HR.
 *
 * HR onboards people, and a Sales Manager is a person being onboarded. These
 * are the same accounts the administrator can open from Department Accounts
 * and the Sales head manages from their own team screen — one record, three
 * doors onto it, so an account opened here is identical to one opened
 * anywhere else.
 *
 * The two things this screen is careful about are both about not stranding
 * anybody: it will not let the last Sales Manager be deactivated, demoted or
 * deleted, and it will not delete somebody who still has live deals. The
 * server enforces both; the page only explains them.
 */

const BLANK = {
  name: "",
  employeeId: "",
  email: "",
  phone: "",
  address: "",
  designation: "Sales Manager",
  role: "sales",
  salesRole: "",
  joiningDate: "",
  workLocation: "",
  employmentType: "",
  reportsTo: "",
  teamSize: "",
  responsibilities: [],
  skills: [],
  password: "",
  status: "active",
};

/**
 * The stored values are snake_case because that is what the model's enums hold;
 * these are what a person reads. Kept beside each other so a value added to the
 * model shows up here as a missing label rather than as a blank dropdown.
 */
const WORK_LOCATION_LABELS = {
  office: "Office",
  field: "Field",
  hybrid: "Hybrid",
  remote: "Remote",
};

const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
};

const labelled = (values, labels) =>
  (values || []).map((value) => ({ value, label: labels[value] || value }));

/** A date input wants YYYY-MM-DD; the API sends an ISO timestamp. */
const dateValue = (value) => (value ? String(value).slice(0, 10) : "");

/**
 * A starting point for the skills box, not a list to choose from — anything
 * typed in is kept. Sales-shaped because this is the sales screen; the box
 * itself accepts whatever the person actually brought.
 */
const SKILL_SUGGESTIONS = [
  "Negotiation",
  "Cold Calling",
  "CRM",
  "Presentation",
  "Client Relationship",
  "Team Leadership",
  "Reporting",
  "MS Excel",
  "English",
  "Hindi",
];

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

/**
 * Inside the People panel the heading and the type dropdown belong to the
 * panel, so `embedded` leaves this screen's own PageHeader out and moves its
 * Add button down into the filter bar — one heading on the page, and the
 * button still beside the table it fills.
 */
export default function SalesManagers({ embedded = false }) {
  const { can } = useHrAccess();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  /**
   * The suggested work locations, employment types and responsibilities come
   * from the server rather than being typed out again here, so the form can
   * never offer a value the model would refuse to store.
   */
  const [choices, setChoices] = useState({
    workLocations: [],
    employmentTypes: [],
    responsibilities: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [removing, setRemoving] = useState(null);

  const canCreate = can("sales_managers", "create");
  const canEdit = can("sales_managers", "edit");
  const canDelete = can("sales_managers", "delete");
  const isNew = editing === "new";

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/sales-managers", {
        params: { search: search || undefined, status: status || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        if (data.choices) setChoices(data.choices);
        setError("");
      })
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load sales accounts")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, status, reloadKey]);

  const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const openNew = () => {
    setForm(BLANK);
    setFormError("");
    setCredentials(null);
    setEditing("new");
  };

  const openEdit = (row) => {
    setForm({
      name: row.name || "",
      employeeId: row.employeeId || "",
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      designation: row.designation || "",
      role: row.role,
      salesRole: row.salesRole || "",
      joiningDate: dateValue(row.joiningDate),
      workLocation: row.workLocation || "",
      employmentType: row.employmentType || "",
      reportsTo: row.reportsTo || "",
      teamSize: row.teamSize ? String(row.teamSize) : "",
      responsibilities: row.responsibilities || [],
      skills: row.skills || [],
      // Never prefilled — the stored value is a one-way hash, and an empty box
      // meaning "leave it alone" is what an edit almost always wants.
      password: "",
      status: row.status || "active",
    });
    setFormError("");
    setCredentials(null);
    setEditing(row);
  };

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (isNew) {
        const { data } = await hrApi.post("/hr/sales-managers", form);
        setCredentials(data.credentials);
        setNotice(data.message || `${form.name} can now sign in`);
      } else {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await hrApi.put(`/hr/sales-managers/${editing._id}`, payload);
        setNotice("Account updated");
        setEditing(null);
      }
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row) => {
    setError("");
    try {
      await hrApi.put(`/hr/sales-managers/${row._id}`, {
        status: row.status === "active" ? "inactive" : "active",
      });
      setNotice(
        row.status === "active"
          ? `${row.name} can no longer sign in`
          : `${row.name} can sign in again`
      );
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not change that account");
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      const { data } = await hrApi.delete(`/hr/sales-managers/${removing._id}`);
      setNotice(data.message || "Account deleted");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that account");
    } finally {
      setRemoving(null);
    }
  };

  /**
   * Who a sales account can be told to report to: the other Sales Managers,
   * never themselves. An executive answering to a manager is the ordinary
   * shape of this team, and a manager may answer to another one.
   */
  const managerOptions = rows
    .filter((row) => row.isSalesHead && row.status === "active" && row._id !== editing?._id)
    .map((row) => ({
      value: row._id,
      label: row.designation ? `${row.name} — ${row.designation}` : row.name,
    }));

  const columns = [
    {
      key: "name",
      header: "Person",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">
            {row.name}
            {row.employeeId && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-normal text-slate-500">
                {row.employeeId}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <div className="space-y-1">
          <Badge
            value={row.isSalesHead ? "Sales Manager" : "Executive"}
            tone={row.isSalesHead ? "blue" : "slate"}
          />
          {(row.salesRole || row.workLocation) && (
            <p className="text-[11px] text-slate-500">
              {[row.salesRole, WORK_LOCATION_LABELS[row.workLocation]].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "responsibilities",
      header: "Handles",
      /**
       * Two chips and a count rather than the whole list. What this column is
       * for is telling two managers apart at a glance — the full list is one
       * click away on the record itself.
       */
      render: (row) => {
        const items = row.responsibilities || [];
        if (!items.length) return <span className="text-slate-300">—</span>;

        return (
          <div className="flex flex-wrap gap-1">
            {items.slice(0, 2).map((item) => (
              <span
                key={item}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                {item}
              </span>
            ))}
            {items.length > 2 && (
              <span className="text-[10px] text-slate-400">+{items.length - 2}</span>
            )}
          </div>
        );
      },
    },
    { key: "phone", header: "Mobile", render: (row) => row.phone || "—" },
    {
      key: "openLeads",
      header: "Live deals",
      render: (row) => (
        <span className={row.openLeads ? "text-slate-800" : "text-slate-400"}>
          {row.openLeads || 0}
        </span>
      ),
    },
    { key: "joiningDate", header: "Joined", render: (row) => shortDate(row.joiningDate || row.createdAt) },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                <Pencil size={13} /> Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleStatus(row)}>
                <Power size={13} /> {row.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            </>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title="Sales Managers"
          subtitle="Logins for the Sales panel — they sign in at /sales/login"
        >
          {canCreate && (
            <Button onClick={openNew}>
              <Plus size={16} /> Add sales account
            </Button>
          )}
        </PageHeader>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Sales accounts", value: counts.total ?? 0 },
          { label: "Active", value: counts.active ?? 0 },
          { label: "Inactive", value: counts.inactive ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search name, email or mobile"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            className="w-40"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />

          {embedded && canCreate && (
            <Button size="sm" className="ml-auto" onClick={openNew}>
              <Plus size={15} /> Add sales account
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="No sales accounts yet"
          emptyMessage="Add a Sales Manager and they will be able to sign in at /sales/login."
        />
      </Card>

      {/* --------------------------------------------------------- the form */}

      <Modal
        open={Boolean(editing)}
        title={isNew ? "Add a sales account" : `Edit ${editing?.name || ""}`}
        subtitle={
          isNew ? "A Sales Manager sees the whole pipeline; an executive sees their own leads" : undefined
        }
        onClose={() => setEditing(null)}
        footer={
          credentials ? (
            <Button onClick={() => setEditing(null)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : isNew ? "Create account" : "Save changes"}
              </Button>
            </>
          )
        }
      >
        {credentials ? (
          <div className="space-y-3">
            <Alert tone="success">
              Account created. Pass these on now — the password cannot be shown again.
            </Alert>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                <KeyRound size={14} /> Login details
              </p>
              <p className="mt-2 text-slate-600">
                Email: <span className="font-mono text-slate-900">{credentials.loginId}</span>
              </p>
              <p className="text-slate-600">
                Password: <span className="font-mono text-slate-900">{credentials.password}</span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                They sign in at {credentials.loginUrl || "/"} — the same address everybody uses. The panel they land on is decided by their role.
              </p>
            </div>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={save}>
            {formError && <Alert>{formError}</Alert>}

            {/* ------------------------------------------------ who they are */}
            <section className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Who they are
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required>
                  <Input name="name" value={form.name} onChange={change} required />
                </Field>
                <Field label="Employee ID" hint="The company's own code — SM-04, EMP-112">
                  <Input
                    name="employeeId"
                    value={form.employeeId}
                    onChange={change}
                    placeholder="Optional"
                    className="font-mono"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" required>
                  <Input type="email" name="email" value={form.email} onChange={change} required />
                </Field>
                <Field label="Mobile" hint="Becomes the password if none is typed" required>
                  <Input name="phone" value={form.phone} onChange={change} required />
                </Field>
              </div>

              <Field label="Address">
                <Textarea
                  name="address"
                  value={form.address}
                  onChange={change}
                  rows={2}
                  placeholder="House, street, city, state, PIN"
                />
              </Field>
            </section>

            {/* ---------------------------------------------------- the job */}
            <section className="space-y-4 border-t border-slate-100 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                The job
              </p>

              <Field
                label="Panel access"
                hint="A Sales Manager also manages the sales team and reassigns leads"
              >
                <Select
                  name="role"
                  value={form.role}
                  onChange={change}
                  options={[
                    { value: "sales", label: "Sales Manager — the whole pipeline" },
                    { value: "sales_exec", label: "Sales Executive — their own leads only" },
                  ]}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Designation" hint="What goes on their card">
                  <Input name="designation" value={form.designation} onChange={change} />
                </Field>
                <Field
                  label="Sales role"
                  hint="The job inside the team — Field Sales Manager, Inside Sales"
                >
                  <Input
                    name="salesRole"
                    value={form.salesRole}
                    onChange={change}
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Joining date">
                  <Input
                    type="date"
                    name="joiningDate"
                    value={form.joiningDate}
                    onChange={change}
                  />
                </Field>
                <Field label="Work location">
                  <Select
                    name="workLocation"
                    value={form.workLocation}
                    onChange={change}
                    placeholder="Not set"
                    options={labelled(choices.workLocations, WORK_LOCATION_LABELS)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Employment type">
                  <Select
                    name="employmentType"
                    value={form.employmentType}
                    onChange={change}
                    placeholder="Not set"
                    options={labelled(choices.employmentTypes, EMPLOYMENT_TYPE_LABELS)}
                  />
                </Field>
                <Field label="Team size" hint="How many people answer to them">
                  <Input
                    type="number"
                    min="0"
                    name="teamSize"
                    value={form.teamSize}
                    onChange={change}
                    placeholder="0"
                  />
                </Field>
              </div>

              <Field
                label="Reporting manager"
                hint={
                  managerOptions.length
                    ? "The Sales Manager they answer to"
                    : "No other active Sales Manager to report to yet"
                }
              >
                <Select
                  name="reportsTo"
                  value={form.reportsTo}
                  onChange={change}
                  placeholder="Nobody — they report to the admin"
                  options={managerOptions}
                  disabled={!managerOptions.length}
                />
              </Field>
            </section>

            {/* ------------------------------------------------ what they do */}
            <section className="space-y-4 border-t border-slate-100 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                What they do
              </p>

              <Field
                label="Work responsibilities"
                hint="Pick as many as apply, or type one that is not listed"
              >
                <TagField
                  value={form.responsibilities}
                  onChange={(next) => setForm((p) => ({ ...p, responsibilities: next }))}
                  suggestions={choices.responsibilities}
                  emptyLabel="No responsibilities picked yet"
                  placeholder="Something else — type it and press Enter"
                />
              </Field>

              <Field label="Skills" hint="What they brought with them">
                <TagField
                  value={form.skills}
                  onChange={(next) => setForm((p) => ({ ...p, skills: next }))}
                  suggestions={SKILL_SUGGESTIONS}
                  emptyLabel="No skills recorded yet"
                  placeholder="A skill — type it and press Enter"
                />
              </Field>
            </section>

            {/* -------------------------------------------------- the login */}
            <section className="space-y-4 border-t border-slate-100 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Signing in
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Password"
                  hint={isNew ? "Blank uses the mobile number" : "Blank keeps the current one"}
                >
                  <Input
                    type="text"
                    name="password"
                    value={form.password}
                    onChange={change}
                    placeholder="••••••"
                  />
                </Field>
                {!isNew && (
                  <Field label="Status">
                    <Select
                      name="status"
                      value={form.status}
                      onChange={change}
                      options={[
                        { value: "active", label: "Active" },
                        { value: "inactive", label: "Inactive" },
                      ]}
                    />
                  </Field>
                )}
              </div>
            </section>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(removing)}
        title="Delete this sales account?"
        onClose={() => setRemoving(null)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Deleting takes {removing?.name}&apos;s name off every lead and call they ever logged.
          {removing?.openLeads ? (
            <>
              {" "}
              They still own <strong>{removing.openLeads}</strong> live deal
              {removing.openLeads === 1 ? "" : "s"}, so the server will refuse until those are
              reassigned from the Sales panel.
            </>
          ) : null}{" "}
          Deactivating is usually the better answer — it stops the login and keeps the history.
        </p>
      </Modal>
    </div>
  );
}
