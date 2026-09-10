import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power, ShieldCheck, Trash2 } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
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

/**
 * The HR team's own logins.
 *
 * There is no limit on how many there may be — three HR people need three
 * logins, because one shared account is an audit trail that says "HR" and
 * never says who approved the leave. The database was found enforcing a
 * ceiling of exactly one through a unique index on users.role; the server
 * removes it on every boot.
 *
 * Everything created here is an HR Manager, and the server enforces that
 * rather than trusting this form: the role is never read from the request. So
 * this screen cannot mint an HR head, an administrator, or anything else.
 */

const BLANK = {
  name: "",
  email: "",
  phone: "",
  designation: "HR Manager",
  password: "",
  status: "active",
};

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
export default function HrManagers({ embedded = false }) {
  const { isHrAdmin } = useHrAccess();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [me, setMe] = useState({ youAre: "", yourId: "" });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
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
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/managers", {
        params: { search: search || undefined, status: status || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.byRole || {});
        setMe({ youAre: data.youAre, yourId: data.yourId });
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load the team"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, status, reloadKey]);

  const openAdd = () => {
    setEditing("new");
    setForm(BLANK);
    setFormError("");
  };

  const openEdit = (row) => {
    // The head's own record is managed elsewhere; the server refuses it here
    if (row.isHead) return;

    setEditing(row._id);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      designation: row.designation || "HR Manager",
      password: "",
      status: row.status || "active",
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
          ? await hrApi.post("/hr/managers", form)
          : await hrApi.put(`/hr/managers/${editing}`, form);

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
      await hrApi.put(`/hr/managers/${row._id}`, {
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
      await hrApi.delete(`/hr/managers/${target._id}`);
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
          <p className="font-medium text-slate-900">
            {row.name}
            {String(row._id) === String(me.yourId) && (
              <span className="ml-2 text-[11px] font-normal text-slate-400">you</span>
            )}
          </p>
          <p className="text-xs text-slate-400">{row.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) =>
        row.isHead ? (
          <Badge tone="black">HR Head</Badge>
        ) : (
          <Badge tone="blue">HR Manager</Badge>
        ),
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
      render: (row) =>
        row.isHead ? (
          // The head's account is the administrator's to manage — saying so
          // beats three buttons that all answer 403
          <span className="text-[11px] text-slate-400">Managed by the admin</span>
        ) : (
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

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="HR Managers"
          subtitle="Logins for the HR team — as many as you need"
        >
          {isHrAdmin && (
            <Button onClick={openAdd}>
              <Plus size={15} />
              Add HR Manager
            </Button>
          )}
        </PageHeader>
      )}

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              HR Managers
            </p>
            <p className="text-xl font-bold text-slate-900">{counts.hr_manager?.total ?? 0}</p>
            <p className="text-[11px] text-slate-400">{counts.hr_manager?.active ?? 0} active</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              HR Heads
            </p>
            <p className="text-xl font-bold text-slate-900">{counts.hr?.total ?? 0}</p>
            <p className="text-[11px] text-slate-400">Created by the administrator</p>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-[200px] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or phone"
            />
          </div>
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

          {embedded && isHrAdmin && (
            <Button size="sm" className="ml-auto" onClick={openAdd}>
              <Plus size={15} /> Add HR manager
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={isHrAdmin ? openEdit : undefined}
          emptyTitle="No HR managers yet"
          emptyMessage="Add one to give a colleague their own HR login."
        />
      </Card>

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" />
        Everything created here is an HR Manager — they get every HR screen except this one. Only
        an administrator can create an HR Head.
      </p>

      {/* ------------------------------------------------------ add / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add an HR Manager" : "Edit HR Manager"}
        subtitle="They sign in at the HR login and see every HR screen but this one"
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

          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>

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
              hint={
                editing === "new"
                  ? "Becomes the password unless one is typed below"
                  : "Changing it resets the password"
              }
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
              />
            </Field>
            <Field
              label="Password"
              hint={
                editing === "new"
                  ? "Optional — the mobile number is used if blank"
                  : "Leave blank to keep the current one"
              }
            >
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 6 characters"
              />
            </Field>
          </div>

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

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <KeyRound size={13} className="mt-0.5 shrink-0" />
            They sign in at the HR login and can change this from their own profile.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete HR login"
        message={`Delete ${target?.name}'s HR login? Deactivating instead keeps their name on every leave they decided. This cannot be undone.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
