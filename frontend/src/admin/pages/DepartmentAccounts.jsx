import { useCallback, useEffect, useState } from "react";
import { IdCard, KeyRound, Pencil, Plus, Power, Trash2 } from "lucide-react";

import adminApi from "../adminApi";
import DataTable from "../../shared/components/DataTable";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "../../shared/components/ui";
import { DEFAULT_PASSWORD } from "../../shared/staffPassword";

/**
 * The department logins: HR, Sales and Operations.
 *
 * There is no limit on how many of each there may be, and that is the point of
 * the screen. A company with three HR people needs three HR accounts — one
 * shared login between them is an audit trail that says "HR" and never says
 * who. The database was found enforcing a ceiling of exactly one HR account
 * through a unique index; utils/dbGuards.js removes it on every boot.
 *
 * Closed to department accounts themselves, here and on the server: an account
 * that can create accounts can grant itself any module, so it is not a
 * question a permission can safely answer.
 */

const BLANK = {
  name: "",
  email: "",
  role: "hr",
  phone: "",
  designation: "",
  department: "",
  password: "",
  status: "active",
  permissionRole: "",
};

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * `lockedRole` pins the screen to one department.
 *
 * The same component serves two entries: the full list under Administration,
 * and "HR Accounts" inside the HR section — because somebody who has come to
 * the panel to add an HR colleague looks for it under Human Resources, not
 * under a general heading three sections further down. Pinning it rather than
 * writing a second screen means the two cannot drift apart.
 */
export default function DepartmentAccounts({
  lockedRole = "",
  openOnLoad = false,
  title,
  subtitle,
  /**
   * Inside the Team & Accounts panel the heading and the type dropdown are the
   * panel's, so this screen drops its PageHeader and puts Add in the filter
   * bar instead — one heading on the page, and the button still where the
   * table is.
   */
  embedded = false,
}) {
  const [meta, setMeta] = useState({ departments: [], roles: [] });
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [role, setRole] = useState(lockedRole);
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // The plaintext password, shown once after it is set
  const [credentials, setCredentials] = useState(null);

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    adminApi
      .get("/admin/department-accounts/meta")
      .then(({ data }) => setMeta(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    adminApi
      .get("/admin/department-accounts", {
        params: { role: role || undefined, status: status || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.byDepartment || {});
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load accounts"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [role, status, reloadKey]);

  const departmentOptions = meta.departments?.map((d) => ({ value: d.value, label: d.label })) || [];

  const roleOptions = [
    { value: "", label: "Department default access" },
    ...(meta.roles || []).map((r) => ({ value: r._id, label: r.name })),
  ];

  const openAdd = () => {
    setEditing("new");
    setForm({ ...BLANK, role: lockedRole || role || "hr" });
    setFormError("");
  };

  /**
   * "Add Sales Manager" in the sidebar lands here with the form already open.
   *
   * Done during render rather than in an effect: an effect would paint the
   * list first and then the form on top of it, which flashes. `openedOnLoad`
   * makes it happen once — closing the form must not immediately reopen it,
   * and the person is still standing on the /add URL when they do.
   */
  const [openedOnLoad, setOpenedOnLoad] = useState(false);
  if (openOnLoad && !openedOnLoad) {
    setOpenedOnLoad(true);
    openAdd();
  }

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      name: row.name || "",
      email: row.email || "",
      role: row.role,
      phone: row.phone || "",
      designation: row.designation || "",
      department: row.department || "",
      password: "",
      status: row.status || "active",
      permissionRole: row.permissionRole?._id || row.permissionRole || "",
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const { data } =
        editing === "new"
          ? await adminApi.post("/admin/department-accounts", form)
          : await adminApi.put(`/admin/department-accounts/${editing}`, form);

      setEditing(null);
      // Only present when a password was actually set or reset
      if (data.credentials) setCredentials({ ...data.credentials, name: form.name });
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this account");
    } finally {
      setSaving(false);
    }
  };

  /** Deactivating is the reversible answer, and the one to reach for first. */
  const toggleStatus = async (row) => {
    setError("");
    try {
      await adminApi.put(`/admin/department-accounts/${row._id}`, {
        status: row.status === "active" ? "inactive" : "active",
      });
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not change that account");
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await adminApi.delete(`/admin/department-accounts/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that account");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Account",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Department",
      render: (row) => <Badge tone="blue">{row.departmentLabel}</Badge>,
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.designation || "—"}</p>
          <p className="text-xs text-slate-400">{row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "permissionRole",
      header: "Access",
      render: (row) =>
        row.permissionRole ? (
          <span className="text-slate-700">{row.permissionRole.name}</span>
        ) : (
          <span className="text-slate-400">Department default</span>
        ),
    },
    { key: "createdAt", header: "Added", render: (row) => shortDate(row.createdAt) },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "active" ? "blue" : "slate"}>
          {row.status === "active" ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleStatus(row);
            }}
            title={row.status === "active" ? "Deactivate" : "Reactivate"}
            className="rounded-md p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
          >
            <Power size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row);
            }}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
            title="Delete"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const chosen = meta.departments?.find((d) => d.value === form.role);
  const lockedLabel = meta.departments?.find((d) => d.value === lockedRole)?.label || "";

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={title || "Department Accounts"}
          subtitle={subtitle || "HR, Sales and Operations logins — as many of each as you need"}
        >
          <Button onClick={openAdd}>
            <Plus size={15} />
            {lockedLabel ? `Add ${lockedLabel}` : "Add Account"}
          </Button>
        </PageHeader>
      )}

      <Alert>{error}</Alert>

      {/* One card per department, doubling as the filter */}
      <div className={`mb-4 grid gap-3 ${lockedRole ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
        {Object.entries(counts)
          // Pinned to one department, the other two are noise
          .filter(([key]) => !lockedRole || key === lockedRole)
          .map(([key, value]) => (
            <button
              key={key}
              onClick={() => !lockedRole && setRole(role === key ? "" : key)}
              disabled={Boolean(lockedRole)}
              className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                role === key
                  ? "border-blue-600 ring-1 ring-blue-600"
                  : "border-slate-200 hover:border-slate-300"
              } ${lockedRole ? "cursor-default" : ""}`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {value.label}
              </p>
              <p className="text-xl font-bold text-slate-900">{value.total}</p>
              <p className="text-[11px] text-slate-400">{value.active} active</p>
            </button>
          ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {!lockedRole && (
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={departmentOptions}
              placeholder="All departments"
              className="w-auto min-w-[180px]"
            />
          )}
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            placeholder="Any status"
            className="w-auto min-w-[140px]"
          />

          {/* Embedded, this is the only Add button on the screen — the panel's
              own header carries the type dropdown instead */}
          {embedded && (
            <Button size="sm" className="ml-auto" onClick={openAdd}>
              <Plus size={15} />
              {lockedLabel ? `Add ${lockedLabel}` : "Add account"}
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={openEdit}
          emptyTitle={lockedLabel ? `No ${lockedLabel} accounts yet` : "No department accounts yet"}
          emptyMessage={
            lockedLabel
              ? `Add one to give somebody in ${lockedLabel} their own login.`
              : "Add one to give somebody in HR, Sales or Operations their own login."
          }
        />
      </Card>

      {/* ------------------------------------------------------ add / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a department account" : "Edit account"}
        subtitle="They sign in at the same admin login and see only their department"
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
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field
              label="Department"
              required
              hint={
                lockedRole && editing === "new"
                  ? "This screen only adds to this department"
                  : undefined
              }
            >
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                options={departmentOptions}
                // Pinned on a new account so the screen does what its heading
                // says; still movable when editing somebody who already exists
                disabled={Boolean(lockedRole) && editing === "new"}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" hint="This is their login ID" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field
              label="Mobile"
              hint={editing === "new" ? "Becomes the password unless one is typed below" : "Changing it resets the password"}
            >
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Designation">
              <Input
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                placeholder="HR Executive"
              />
            </Field>
            <Field
              label="Password"
              hint={editing === "new" ? `Optional — ${DEFAULT_PASSWORD} is used if blank` : "Leave blank to keep the current one"}
            >
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 6 characters"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Access"
              hint="A role overrides the department's defaults for this one account"
            >
              <Select
                value={form.permissionRole}
                onChange={(e) => setForm({ ...form, permissionRole: e.target.value })}
                options={roleOptions}
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive — cannot sign in" },
                ]}
              />
            </Field>
          </div>

          {/* What "department default" actually means, rather than asking
              somebody to take it on faith */}
          {chosen?.portal && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              This account signs in at the{" "}
              <strong className="font-medium text-slate-800">{chosen.portal.label}</strong> —{" "}
              <code className="rounded bg-white px-1">{chosen.portal.path}</code>
            </p>
          )}

          {!form.permissionRole && chosen?.modules?.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {chosen.label} reaches
              </p>
              <div className="flex flex-wrap gap-1.5">
                {chosen.modules.map((module) => (
                  <span
                    key={module}
                    className="rounded-md bg-white px-2 py-0.5 text-[11px] capitalize text-slate-600 ring-1 ring-inset ring-slate-200"
                  >
                    {module.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* --------------------------------------------------- the credentials */}
      <Modal
        open={Boolean(credentials)}
        onClose={() => setCredentials(null)}
        title="Login details"
        subtitle="Pass these on now — the password cannot be read back afterwards"
        size="sm"
        footer={<Button onClick={() => setCredentials(null)}>Done</Button>}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Login ID
            </p>
            <p className="mb-3 font-mono text-sm text-slate-900">{credentials?.loginId}</p>

            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Password
            </p>
            <p className="font-mono text-sm text-slate-900">{credentials?.password}</p>
          </div>

          {/* Which door this account actually opens. HR is refused by the
              admin login, so reading out the credentials without saying so
              sends somebody to a page that will not let them in. */}
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <KeyRound size={13} className="mt-0.5 shrink-0" />
            They sign in at the{" "}
            <strong className="font-medium text-slate-700">
              {credentials?.portal?.label || "Admin panel"}
            </strong>{" "}
            — <code className="rounded bg-slate-100 px-1">{credentials?.portal?.path || "/"}</code> — and
            can change this password from their own profile.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete account"
        message={`Delete ${target?.name}'s ${target?.departmentLabel} login? Deactivating instead keeps their name on everything they decided. This cannot be undone.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <IdCard size={13} className="mt-0.5 shrink-0" />
        Sales and Operations sign in at this admin login. HR has a panel of its own at{" "}
        <code className="rounded bg-slate-100 px-1">/hr/login</code> and is refused here — which is
        what keeps HR out of the pipeline, the vault and the projects entirely.
      </p>
    </div>
  );
}
