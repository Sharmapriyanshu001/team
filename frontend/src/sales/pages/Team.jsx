import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Power, Trash2, UserPlus } from "lucide-react";

import salesApi from "../salesApi";
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
} from "../../shared/components/ui";
import { money } from "../constants";

/**
 * The sales floor: who is on it, and how each of them is doing.
 *
 * Head only — the routes behind this refuse an executive, and the sidebar
 * leaves the entry out for them so the panel does not offer a door that will
 * not open.
 *
 * Everything created here is a sales executive, and the server enforces that
 * rather than trusting this form: the role is never read from the request. So
 * this screen cannot mint a second head, an administrator, or anything else.
 * Promotion is a deliberate, separate edit.
 *
 * "My team" is the people who report to this manager — whoever they opened an
 * account for. The second tab is everybody the reporting line does not cover
 * yet: accounts that existed before it did, and anyone HR onboarded without
 * saying whose team they join. Those are visible to every manager and managed
 * by none until one claims them, which is the only thing that tab's rows can
 * do — a person already on a team is not there to be taken.
 */

const BLANK = {
  name: "",
  email: "",
  phone: "",
  designation: "Sales Executive",
  password: "",
  status: "active",
};

export default function Team() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState("team");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [removing, setRemoving] = useState(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const isNew = editing === "new";

  useEffect(() => {
    let active = true;
    setLoading(true);
    salesApi
      .get("/sales/team", {
        params: { search: search || undefined, view: view === "team" ? undefined : view },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load the team"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [view, search, reloadKey]);

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
      email: row.email || "",
      phone: row.phone || "",
      designation: row.designation || "Sales Executive",
      // Never prefilled — the stored value is a one-way hash, and an empty box
      // meaning "leave it alone" is what an edit almost always wants.
      password: "",
      status: row.status || "active",
      role: row.role,
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
        const { data } = await salesApi.post("/sales/team", form);
        setCredentials(data.credentials);
        setNotice(data.message || `${form.name} can now sign in`);
      } else {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await salesApi.put(`/sales/team/${editing._id}`, payload);
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
    try {
      await salesApi.put(`/sales/team/${row._id}`, {
        status: row.status === "active" ? "inactive" : "active",
      });
      setNotice(
        row.status === "active" ? `${row.name} can no longer sign in` : `${row.name} can sign in again`
      );
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not change that account");
    }
  };

  /**
   * Take an unmanaged executive onto this team. Reloads rather than moving the
   * row across in place: they leave the unclaimed list and join the other one,
   * and a row that quietly changes meaning where it sits reads as a bug.
   */
  const claim = async (row) => {
    try {
      const { data } = await salesApi.put(`/sales/team/${row._id}/claim`);
      setNotice(data.message || `${row.name} is now on your team`);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add them to your team");
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      const { data } = await salesApi.delete(`/sales/team/${removing._id}`);
      setNotice(data.message || "Account deleted");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that account");
    } finally {
      setRemoving(null);
    }
  };

  const unclaimed = view === "unclaimed";

  const columns = [
    {
      key: "name",
      header: "Person",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.email}</p>
          {row.managerName && (
            <p className="text-xs text-slate-400">Reports to {row.managerName}</p>
          )}
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge value={row.isSalesHead ? "head" : "executive"} tone={row.isSalesHead ? "blue" : "slate"} />,
    },
    {
      key: "pipeline",
      header: "Open pipeline",
      render: (row) => (
        <div>
          <p className="text-slate-800">{money(row.stats?.pipelineValue)}</p>
          <p className="text-xs text-slate-500">{row.stats?.open || 0} live</p>
        </div>
      ),
    },
    {
      key: "won",
      header: "Won",
      render: (row) => (
        <div>
          <p className="text-slate-800">{money(row.stats?.wonValue)}</p>
          <p className="text-xs text-slate-500">{row.stats?.won || 0} deals</p>
        </div>
      ),
    },
    {
      key: "conversion",
      header: "Conversion",
      render: (row) => <span className="text-slate-700">{row.stats?.conversionRate ?? 0}%</span>,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) =>
        unclaimed ? (
          /**
           * The only thing on offer for somebody who is not yours yet. Editing
           * or deactivating another manager's hire — or one nobody has taken
           * responsibility for — is not this screen's business until it is.
           */
          <div className="flex justify-end">
            <Button size="sm" onClick={() => claim(row)}>
              <UserPlus size={13} /> Add to my team
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
              <Pencil size={13} /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggleStatus(row)}>
              <Power size={13} /> {row.status === "active" ? "Deactivate" : "Activate"}
            </Button>
            {!row.isSalesHead && (
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
      <PageHeader
        title="Sales team"
        subtitle="Your own people, and how each of their pipelines looks"
      >
        <Button onClick={openNew}>
          <Plus size={16} /> Add executive
        </Button>
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "On the team", value: counts.total ?? 0 },
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
          {/**
           * Two lists, not a filter. The rows mean different things and offer
           * different actions, so switching between them is a deliberate move
           * rather than a dropdown somebody leaves set by accident.
           */}
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {[
              { key: "team", label: "My team", count: counts.total ?? 0 },
              { key: "unclaimed", label: "Unclaimed", count: counts.unclaimed ?? 0 },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setView(tab.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === tab.key
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-xs text-slate-400">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <Input
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle={unclaimed ? "Nobody is waiting" : "Nobody on your team yet"}
          emptyMessage={
            unclaimed
              ? "Every sales executive is on somebody's team. Anyone HR onboards without a manager shows up here."
              : "Add an executive and they will report to you, and be able to sign in at /sales/login."
          }
        />
      </Card>

      {/* --------------------------------------------------------- the form */}

      <Modal
        open={Boolean(editing)}
        title={isNew ? "Add a sales executive" : `Edit ${editing?.name || ""}`}
        subtitle={
          isNew
            ? "They join your team, and will see only the leads assigned to them"
            : undefined
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
                They sign in at {credentials.loginUrl || "/"} — the same address everybody uses
              </p>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={save}>
            {formError && <Alert>{formError}</Alert>}

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
              <Field label="Designation">
                <Input name="designation" value={form.designation} onChange={change} />
              </Field>
            </div>

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

            {!isNew && (
              <Field
                label="Role"
                hint="Promoting somebody to head gives them the whole pipeline and this screen"
              >
                <Select
                  name="role"
                  value={form.role}
                  onChange={change}
                  options={[
                    { value: "sales_exec", label: "Sales executive" },
                    { value: "sales", label: "Sales head" },
                  ]}
                />
              </Field>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(removing)}
        title="Delete this account?"
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
          Deleting takes {removing?.name}&apos;s name off every lead they ever worked. If they still
          own open deals the server will refuse until those are reassigned — deactivating is usually
          the better answer.
        </p>
      </Modal>
    </div>
  );
}
