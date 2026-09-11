import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power, Trash2, UserRound } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import DataTable from "../../shared/components/DataTable";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
import OnboardingFields from "../components/OnboardingFields";
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
 * The company's department managers.
 *
 * These are the accounts the admin panel calls Managers: a department head who
 * runs a team and signs in to the operations manager panel. They are staff, and staff
 * are HR's job, so HR opens the login rather than asking an administrator
 * every time somebody is promoted.
 *
 * Not to be confused with HR Managers in the sidebar below, which are logins
 * for the HR team itself — different people, different panel, different role.
 * The server writes role:"manager" on every save whatever this form sends, so
 * nothing here can create an administrator.
 *
 * Creating one asks for the same onboarding pack the admin panel asks for —
 * Aadhaar, PAN and bank, with the scans. That is not a rule this screen
 * invented: it lives in utils/staffDocuments.js and applies to every staff
 * record in the app, so a manager HR opens is as complete as one an
 * administrator opens. Editing does not ask again, because the requirement is
 * on creation only.
 */

const BLANK = {
  name: "",
  email: "",
  phone: "",
  designation: "Manager",
  department: "",
  password: "",
  status: "active",
  joiningDate: "",
  documents: { aadhaarNumber: "", panNumber: "" },
  bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "" },
};

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

/**
 * The paperwork is collected here, and no longer holds the account up.
 *
 * This screen used to refuse a create without an Aadhaar number, full bank
 * details and all four scans — mirroring what the server demanded. The server
 * stopped demanding them (see utils/staffDocuments.js: a person starts on
 * Monday and their PAN photo arrives on Thursday, and blocking the login until
 * then helped nobody), and this check stayed behind. Left as it was it would
 * refuse a manager the server is perfectly willing to create.
 *
 * The fields are still on the form and still saved. What is missing shows on
 * the manager's own record, which is where somebody chasing it looks.
 */

/**
 * Inside the People panel the heading and the type dropdown belong to the
 * panel, so `embedded` leaves this screen's own PageHeader out and moves its
 * Add button down into the filter bar — one heading on the page, and the
 * button still beside the table it fills.
 */
export default function DepartmentManagers({ embedded = false }) {
  const { can } = useHrAccess();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [files, setFiles] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [credentials, setCredentials] = useState(null);

  const canCreate = can("department_managers", "create");
  const canEdit = can("department_managers", "edit");
  const canDelete = can("department_managers", "delete");
  const isNew = editing === "new";

  /**
   * The row and the thing about to happen to it: { row, action }.
   *
   * One piece of state for all three confirmations rather than a flag each —
   * they are mutually exclusive by definition, and three booleans is three
   * chances for two dialogs to open at once.
   */
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      hrApi.get("/hr/department-managers", {
        params: { search: search || undefined, status: status || undefined },
      }),
      hrApi.get("/hr/department-managers/summary"),
    ])
      .then(([list, summary]) => {
        if (!active) return;
        setRows(list.data.items || []);
        setCounts(summary.data.counts || {});
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load managers");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, status, reloadKey]);

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const changeIn = (section) => (e) =>
    setForm((prev) => ({
      ...prev,
      [section]: { ...prev[section], [e.target.name]: e.target.value },
    }));

  const pickFile = (name, file) => setFiles((prev) => ({ ...prev, [name]: file }));

  const closeForm = () => {
    setEditing(null);
    setStep(0);
    setFiles({});
    setCredentials(null);
  };

  const openNew = () => {
    setForm(BLANK);
    setFiles({});
    setFormError("");
    setCredentials(null);
    setStep(0);
    setEditing("new");
  };

  const openEdit = (row) => {
    setForm({
      ...BLANK,
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      designation: row.designation || "Manager",
      department: row.department || "",
      status: row.status || "active",
      // Never prefilled — the stored value is a one-way hash, and an empty box
      // meaning "leave it alone" is what an edit almost always wants.
      password: "",
    });
    setFiles({});
    setFormError("");
    setCredentials(null);
    setStep(0);
    setEditing(row);
  };

  const save = async (e) => {
    e?.preventDefault();

    if (isNew && !String(form.name || "").trim()) {
      setStep(0);
      setFormError("Enter their name");
      return;
    }
    if (isNew && !String(form.email || "").trim()) {
      setStep(0);
      setFormError("Enter their email — it is the login ID");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      if (isNew) {
        /**
         * Multipart, because of the scans. The two sub-documents travel as
         * JSON strings beside the files — a FormData is flat, and the server
         * would otherwise get "documents[aadhaarNumber]" style keys to
         * reassemble. Same shape the admin panel's staff form sends.
         */
        const body = new FormData();

        const basics = {
          name: form.name,
          email: form.email,
          phone: form.phone,
          designation: form.designation,
          department: form.department,
          status: form.status,
        };
        if (form.password) basics.password = form.password;
        if (form.joiningDate) basics.joiningDate = form.joiningDate;

        Object.entries(basics).forEach(([key, value]) => body.append(key, value ?? ""));
        body.append("documents", JSON.stringify(form.documents));
        body.append("bank", JSON.stringify(form.bank));

        Object.entries(files).forEach(([name, file]) => file && body.append(name, file));

        await hrApi.post("/hr/department-managers", body);

        setCredentials({
          loginId: form.email,
          // The server falls back to the starting password when none is typed
          password: form.password || form.phone,
        });
        setNotice(`${form.name} can now sign in`);
      } else {
        const payload = {
          name: form.name,
          email: form.email,
          phone: form.phone,
          designation: form.designation,
          department: form.department,
          status: form.status,
        };
        if (form.password) payload.password = form.password;

        await hrApi.put(`/hr/department-managers/${editing._id}`, payload);
        setNotice("Manager updated");
        closeForm();
      }
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Deactivating is a status edit — the account keeps everything it decided.
   *
   * Confirmed first, because it takes effect immediately and from the other
   * side it is indistinguishable from being sacked: the next time they open
   * the panel they are signed out and refused. One misplaced click on a row
   * that looks like the one above it should not do that.
   */
  const toggleStatus = async (row) => {
    setNotice("");
    setBusy(true);
    try {
      await hrApi.put(`/hr/department-managers/${row._id}`, {
        status: row.status === "active" ? "inactive" : "active",
      });
      setNotice(
        row.status === "active"
          ? `${row.name} can no longer sign in`
          : `${row.name} can sign in again`
      );
      setConfirming(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not change that account");
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Closing the account for good, with their scans and papers.
   *
   * Offered second and worded plainly, because deactivating is almost always
   * the right answer: it keeps every task, team and decision the person's name
   * is on. This is for somebody who was never really here.
   */
  const removeManager = async (row) => {
    setNotice("");
    setBusy(true);
    try {
      await hrApi.delete(`/hr/department-managers/${row._id}`);
      setNotice(`${row.name}'s account was deleted`);
      setConfirming(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that account");
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Manager",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (row) => (
        <div>
          <p className="text-slate-900">{row.department || "—"}</p>
          <p className="text-xs text-slate-500">{row.designation || "Manager"}</p>
        </div>
      ),
    },
    { key: "phone", header: "Mobile", render: (row) => row.phone || "—" },
    {
      key: "joiningDate",
      header: "Joined",
      render: (row) => shortDate(row.joiningDate || row.createdAt),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setConfirming({ row, action: row.status === "active" ? "deactivate" : "activate" })
              }
            >
              <Power size={14} /> {row.status === "active" ? "Deactivate" : "Activate"}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming({ row, action: "delete" })}
              title="Delete this account"
            >
              <Trash2 size={14} />
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
          title="Managers"
          subtitle="Department heads who run a team. They sign in at the operations manager panel."
        >
          {canCreate && (
            <Button onClick={openNew}>
              <Plus size={16} /> Add manager
            </Button>
          )}
        </PageHeader>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: counts.total ?? 0 },
          { label: "Active", value: counts.active ?? 0 },
          { label: "Inactive", value: counts.inactive ?? 0 },
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search name, email or department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            className="w-40"
          />

          {embedded && canCreate && (
            <Button size="sm" className="ml-auto" onClick={openNew}>
              <Plus size={15} /> Add manager
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="No managers yet"
          emptyMessage="Add a department head and they will be able to sign in at the operations manager panel."
        />
      </Card>

      {/* -------------------------------------------------------- the form */}

      <Modal
        open={Boolean(editing)}
        title={isNew ? "Add manager" : `Edit ${editing?.name || ""}`}
        subtitle={
          credentials
            ? undefined
            : isNew
              ? step === 0
                ? "Step 1 of 2 · Who they are"
                : "Step 2 of 2 · Identity and bank"
              : "A department head with a login for the operations manager panel"
        }
        onClose={closeForm}
        size="lg"
        footer={
          credentials ? (
            <Button onClick={closeForm}>Done</Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => (isNew && step === 1 ? setStep(0) : closeForm())}
                disabled={saving}
              >
                {isNew && step === 1 ? "Back" : "Cancel"}
              </Button>
              {isNew && step === 0 ? (
                <Button onClick={() => setStep(1)}>Next</Button>
              ) : (
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : isNew ? "Create manager" : "Save changes"}
                </Button>
              )}
            </>
          )
        }
      >
        {credentials ? (
          /**
           * Shown once, after a create. The stored password is a one-way hash
           * and cannot be read back later, so this is the only moment it can be
           * handed over.
           */
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
              <p className="mt-2 text-xs text-slate-500">They sign in at /operation-manager/login</p>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={save}>
            {formError && <Alert>{formError}</Alert>}

            {(!isNew || step === 0) && (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <UserRound size={15} /> Who they are
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" required>
                    <Input name="name" value={form.name} onChange={change} required />
                  </Field>
                  <Field label="Email" required>
                    <Input type="email" name="email" value={form.email} onChange={change} required />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Mobile" hint="Becomes the password if none is typed" required>
                    <Input name="phone" value={form.phone} onChange={change} required />
                  </Field>
                  <Field label="Department">
                    <Input
                      name="department"
                      value={form.department}
                      onChange={change}
                      placeholder="Sales, Operations…"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Designation">
                    <Input name="designation" value={form.designation} onChange={change} />
                  </Field>
                  <Field
                    label="Password"
                    hint={isNew ? `Blank uses ${DEFAULT_PASSWORD}` : "Blank keeps the current one"}
                  >
                    <Input
                      type="text"
                      name="password"
                      value={form.password}
                      onChange={change}
                      placeholder="••••••"
                    />
                  </Field>
                </div>

                {isNew && (
                  <Field label="Joining date">
                    <Input
                      type="date"
                      name="joiningDate"
                      value={form.joiningDate}
                      onChange={change}
                    />
                  </Field>
                )}

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
              </>
            )}

            {isNew && step === 1 && (
              <OnboardingFields
                form={form}
                changeIn={changeIn}
                files={files}
                pickFile={pickFile}
              />
            )}
          </form>
        )}
      </Modal>

      {/**
       * One dialog, three questions.
       *
       * All three are immediate and visible to the person they are about, so
       * none of them happens on a single click. The wording differs because
       * the consequences do: deactivating is reversible and says so, deleting
       * is not and says that instead.
       */}
      <ConfirmDialog
        open={Boolean(confirming)}
        loading={busy}
        onClose={() => setConfirming(null)}
        title={
          confirming?.action === "delete"
            ? `Delete ${confirming?.row?.name}'s account?`
            : confirming?.action === "deactivate"
              ? `Stop ${confirming?.row?.name} signing in?`
              : `Let ${confirming?.row?.name} sign in again?`
        }
        confirmLabel={
          confirming?.action === "delete"
            ? "Delete the account"
            : confirming?.action === "deactivate"
              ? "Deactivate"
              : "Activate"
        }
        variant={confirming?.action === "activate" ? "primary" : "danger"}
        message={
          confirming?.action === "delete"
            ? "This removes the account, their scans and their previous-employment papers for good. Their name comes off everything they ever touched, and it cannot be undone — deactivating keeps all of that and stops the login just the same."
            : confirming?.action === "deactivate"
              ? "They are signed out everywhere straight away and refused at the login. Everything they decided stays on record, and you can turn this back on whenever you like."
              : "They will be able to sign in again from now on."
        }
        onConfirm={() =>
          confirming?.action === "delete"
            ? removeManager(confirming.row)
            : toggleStatus(confirming.row)
        }
      />
    </div>
  );
}
