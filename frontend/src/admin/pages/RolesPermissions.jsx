import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";

import adminApi from "../adminApi";
import Administrators from "./Administrators";
import { prettify } from "../../shared/format";
import { useCrud } from "../hooks/crud";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Textarea,
} from "../../shared/components/ui";

const EMPTY = { name: "", key: "", description: "", permissions: {} };

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export default function RolesPermissions() {
  const crud = useCrud("roles", { limit: 50 });

  const [meta, setMeta] = useState({ modules: [], actions: [] });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    adminApi
      .get("/admin/roles/meta")
      .then(({ data }) => setMeta(data))
      .catch(() => setMeta({ modules: [], actions: [] }));
  }, []);

  const openNew = () => {
    setForm(EMPTY);
    setFormError("");
    setEditing("new");
  };

  const openEdit = (role) => {
    setForm({
      name: role.name,
      key: role.key,
      description: role.description || "",
      permissions: role.permissions || {},
    });
    setFormError("");
    setEditing(role);
  };

  const toggle = (module, action) =>
    setForm((prev) => {
      const current = prev.permissions[module] || [];
      const next = current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action];

      const permissions = { ...prev.permissions };
      if (next.length) permissions[module] = next;
      else delete permissions[module];

      return { ...prev, permissions };
    });

  const toggleModule = (module, allSelected) =>
    setForm((prev) => {
      const permissions = { ...prev.permissions };
      if (allSelected) delete permissions[module];
      else permissions[module] = [...meta.actions];
      return { ...prev, permissions };
    });

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const payload = { ...form, key: form.key || slugify(form.name) };
      if (editing === "new") await crud.create(payload);
      else await crud.update(editing._id, payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the role");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete the role");
    } finally {
      setDeleting(false);
    }
  };

  const countPermissions = (permissions = {}) =>
    Object.values(permissions).reduce((sum, actions) => sum + actions.length, 0);

  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle="Define what each type of user can do">
        <Button onClick={openNew}>
          <Plus size={15} />
          Add Role
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      {crud.loading ? (
        <Loader />
      ) : !crud.rows.length ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="No roles defined"
            message="Create roles to describe what team leaders, employees and other users can access."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {crud.rows.map((role) => (
            <Card key={role._id} className="flex flex-col">
              <CardHeader
                title={role.name}
                subtitle={role.description || role.key}
                action={
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(role)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    >
                      <Pencil size={15} />
                    </button>
                    {!role.isSystem && (
                      <button
                        onClick={() => setTarget(role)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                }
              />

              <div className="flex-1 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone={role.isSystem ? "black" : "blue"}>
                    {role.isSystem ? "System role" : "Custom"}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    {countPermissions(role.permissions)} permissions
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(role.permissions || {}).map(([module, actions]) => (
                    <span
                      key={module}
                      title={actions.join(", ")}
                      className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
                    >
                      {prettify(module)}
                      <span className="ml-1 text-slate-400">{actions.length}</span>
                    </span>
                  ))}
                  {!Object.keys(role.permissions || {}).length && (
                    <span className="text-xs text-slate-400">No permissions granted</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Administrators roles={crud.rows} />

      <Modal
        open={Boolean(editing)}
        size="lg"
        title={editing === "new" ? "Add role" : `Edit ${editing?.name || "role"}`}
        subtitle="Tick the actions this role is allowed to perform in each module"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Save role
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave}>
          <Alert>{formError}</Alert>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Role name" required>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                    key: editing === "new" ? slugify(e.target.value) : prev.key,
                  }))
                }
                required
                placeholder="Project Manager"
              />
            </Field>

            <Field label="Key" hint="Used internally, lowercase with underscores">
              <Input
                value={form.key}
                onChange={(e) => setForm((prev) => ({ ...prev, key: slugify(e.target.value) }))}
                placeholder="project_manager"
              />
            </Field>

            <Field label="Description" className="sm:col-span-2">
              <Textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
                placeholder="What this role is responsible for"
              />
            </Field>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-slate-700">Permissions</p>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Module
                    </th>
                    {meta.actions.map((action) => (
                      <th
                        key={action}
                        className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {action}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      All
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {meta.modules.map((module) => {
                    const granted = form.permissions[module] || [];
                    const all = meta.actions.length > 0 && granted.length === meta.actions.length;

                    return (
                      <tr key={module} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-700">
                          {prettify(module)}
                        </td>
                        {meta.actions.map((action) => (
                          <td key={action} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={granted.includes(action)}
                              onChange={() => toggle(module, action)}
                              className="h-4 w-4 accent-blue-600"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={all}
                            onChange={() => toggleModule(module, all)}
                            className="h-4 w-4 accent-slate-900"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete role"
        message={`Delete the "${target?.name}" role?`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
