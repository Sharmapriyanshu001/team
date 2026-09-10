import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Check,
  ChevronRight,
  Code2,
  Download,
  FileArchive,
  FileCode2,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipList,
  EmptyState,
  Field,
  Input,
  Loader,
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

// Kept in step with MAX_UPLOAD_BYTES on the server
const MAX_UPLOAD_MB = 50;

const STACK_TONES = {
  static: "sky",
  react: "blue",
  vite: "blue",
  next: "blue",
  node: "black",
  unknown: "slate",
};

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

/** Saves a blob the browser fetched behind the admin's token. */
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * Code Projects — the admin half of the workspace feature.
 *
 * Upload a project's archive once, assign the people who work on it, and it
 * stops needing to travel over chat. The workspace those people open is built
 * on these same records.
 */
export default function CodeProjects() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [assignFor, setAssignFor] = useState(null);
  const [treeFor, setTreeFor] = useState(null);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState("");

  // Name and description are small edits, so they happen on the card itself
  // rather than behind a modal. Only one card can be in edit mode at a time.
  const [editing, setEditing] = useState(null); // { id, name, description }
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get("/admin/code-projects");
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load code projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const downloadArchive = async (row) => {
    setBusyId(row._id);
    try {
      const { data } = await adminApi.get(`/admin/code-projects/${row._id}/archive`, {
        responseType: "blob",
      });
      saveBlob(data, row.zipOriginalName || `${row.name}.zip`);
    } catch {
      setError("Could not download the original archive");
    } finally {
      setBusyId("");
    }
  };

  const startEdit = (row) => {
    setEditError("");
    setEditing({ id: row._id, name: row.name, description: row.description || "" });
  };

  const cancelEdit = () => {
    setEditError("");
    setEditing(null);
  };

  const saveEdit = async () => {
    if (!editing || editSaving) return;

    const name = editing.name.trim();
    const description = editing.description.trim();
    const current = items.find((row) => row._id === editing.id);

    if (!name) {
      setEditError("Give the project a name");
      return;
    }
    // Opened the editor and changed nothing — treat it as a cancel so the list
    // is not told about an edit that never happened.
    if (name === current?.name && description === (current?.description || "")) {
      cancelEdit();
      return;
    }

    setEditSaving(true);
    setEditError("");

    try {
      const { data } = await adminApi.put(`/admin/code-projects/${editing.id}`, {
        name,
        description,
      });
      // Patch the single row instead of reloading: the rest of the list has not
      // changed, and a reload would blink every card for a two-field edit.
      // ?? not || so clearing the description sticks instead of springing back.
      setItems((prev) =>
        prev.map((row) =>
          row._id === editing.id
            ? {
                ...row,
                name: data.item?.name ?? name,
                description: data.item?.description ?? description,
              }
            : row
        )
      );
      setSuccess(data.message || "Project updated");
      setEditing(null);
    } catch (err) {
      setEditError(err.response?.data?.message || "Could not save the changes");
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const { data } = await adminApi.delete(`/admin/code-projects/${target._id}`);
      setSuccess(data.message || "Deleted");
      setTarget(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete it");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Code Projects"
        subtitle="Upload a project once, assign who works on it, and it never needs to travel over chat"
      >
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          Create Project
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {loading ? (
        <Card>
          <Loader label="Loading code projects…" />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="No code projects yet"
            message="Create one, upload its ZIP, and assign the operations manager and employees who work on it."
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((row) => {
            const people = [...(row.operationsManagers || []), ...(row.employees || [])];
            const refused = row.extractReport?.rejected?.length || 0;

            return (
              <Card key={row._id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <FileCode2 size={18} />
                  </span>

                  <div className="min-w-0 flex-1">
                    {editing?.id === row._id ? (
                      <input
                        autoFocus
                        value={editing.name}
                        disabled={editSaving}
                        placeholder="Project name"
                        onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit();
                          }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="w-full rounded-md border border-blue-400 px-2 py-1 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-slate-900">{row.name}</p>
                        <button
                          type="button"
                          title="Edit name & description"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => startEdit(row)}
                          className="rounded-md p-1 text-slate-300 transition-colors hover:bg-blue-50 hover:text-blue-600"
                        >
                          <Pencil size={13} />
                        </button>
                        <Badge tone={STACK_TONES[row.stack] || "slate"}>{row.stack}</Badge>
                        {row.status === "archived" && <Badge tone="slate">archived</Badge>}
                      </div>
                    )}
                    <p className="truncate text-xs text-slate-400">
                      {row.fileCount} files · {formatSize(row.totalSize)} ·{" "}
                      {row.zipOriginalName}
                    </p>

                    {editing?.id === row._id ? (
                      <div className="mt-1.5">
                        <textarea
                          rows={2}
                          value={editing.description}
                          disabled={editSaving}
                          placeholder="Description — what this project is, or a note for whoever opens it"
                          onChange={(e) =>
                            setEditing((prev) => ({ ...prev, description: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            // Enter belongs to the textarea, so saving from here
                            // takes the modifier every editor uses for "send".
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              saveEdit();
                            }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                        />

                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          {editError ? (
                            <p className="text-xs text-red-600">{editError}</p>
                          ) : (
                            <p className="text-[11px] text-slate-400">Esc to cancel</p>
                          )}
                          <div className="flex shrink-0 gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={editSaving}
                              onClick={cancelEdit}
                            >
                              <X size={13} />
                              Cancel
                            </Button>
                            <Button size="sm" loading={editSaving} onClick={saveEdit}>
                              <Check size={13} />
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      row.description && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">
                          {row.description}
                        </p>
                      )
                    )}
                  </div>
                </div>

                {/* A record whose extraction never finished is unusable, and
                    saying so beats a card that quietly reads "0 files". */}
                {!row.workspaceReady && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-snug text-red-800 ring-1 ring-inset ring-red-100">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Extraction did not finish, so this project cannot be opened. Delete it and
                      upload again.
                    </span>
                  </p>
                )}

                {refused > 0 && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                    {refused} entr{refused === 1 ? "y was" : "ies were"} refused as unsafe and not
                    extracted
                  </p>
                )}

                {/* Takes up whatever height the card was stretched to, so the
                    action row below sits on the card's bottom edge. Cards in a
                    row are already the same height; without this the buttons
                    floated at whatever height the content happened to end, and
                    a card with a description sat a line lower than one without. */}
                <div className="mt-3 grow border-t border-slate-100 pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <Users size={13} />
                      {people.length ? `Assigned to ${people.length}` : "Not assigned yet"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAssignFor(row)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                    >
                      {people.length ? "Change" : "Assign"}
                    </button>
                  </div>
                  {people.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {people.map((person) => (
                        <span
                          key={person._id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-600 ring-1 ring-inset ring-slate-200"
                        >
                          {person.name}
                          <span className="text-[10px] opacity-70">
                            {person.role === "operations_manager" ? "Lead" : "Emp"}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-slate-100 pt-3">
                  <Button
                    size="sm"
                    disabled={!row.workspaceReady}
                    title={row.workspaceReady ? "" : "This project has no extracted workspace"}
                    onClick={() => navigate(`/admin/code-projects/${row._id}/workspace`)}
                  >
                    <Code2 size={13} />
                    Open Workspace
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTreeFor(row)}>
                    <FolderOpen size={13} />
                    Files
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === row._id}
                    onClick={() => downloadArchive(row)}
                  >
                    <Download size={13} />
                    Original ZIP
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setTarget(row)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(message) => {
          setSuccess(message);
          load();
        }}
      />

      {assignFor && (
        <AssignModal
          project={assignFor}
          onClose={() => setAssignFor(null)}
          onSaved={(message) => {
            setSuccess(message);
            setAssignFor(null);
            load();
          }}
        />
      )}

      {treeFor && <FileTreeModal project={treeFor} onClose={() => setTreeFor(null)} />}

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete code project"
        message={`Remove "${target?.name}"? It moves to the bin — everyone assigned to it loses access straight away, but nothing is destroyed. You can restore it, or delete it for good, from Requests & Bin.`}
        confirmLabel="Move to bin"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------- create */

const EMPTY = {
  name: "",
  description: "",
  project: "",
  canEdit: true,
  canCreateDelete: false,
  canRun: true,
};

function CreateProjectModal({ open, onClose, onCreated }) {
  const lookups = useLookups();
  const fileInput = useRef(null);

  const [form, setForm] = useState(EMPTY);
  const [leaders, setLeaders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [zip, setZip] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const toggle = (key) => setForm((prev) => ({ ...prev, [key]: !prev[key] }));

  const leaderOptions = lookups.operationsManagers.map((p) => ({ value: p._id, label: p.name }));
  const employeeOptions = lookups.employees.map((p) => ({ value: p._id, label: p.name }));

  const pickedLeaders = leaderOptions.filter((o) => leaders.includes(o.value));
  const pickedEmployees = employeeOptions.filter((o) => employees.includes(o.value));

  const pickZip = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.zip$/i.test(file.name)) {
      setError("The project must be uploaded as a .zip");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`That ZIP is over the ${MAX_UPLOAD_MB} MB limit`);
      e.target.value = "";
      return;
    }

    setError("");
    setZip(file);
    setForm((prev) => ({ ...prev, name: prev.name || file.name.replace(/\.zip$/i, "") }));
  };

  const clearZip = () => {
    setZip(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const close = () => {
    setForm(EMPTY);
    setLeaders([]);
    setEmployees([]);
    clearZip();
    setError("");
    onClose();
  };

  const handleSave = async (e) => {
    e?.preventDefault();

    if (!form.name.trim()) {
      setError("Give the project a name");
      return;
    }
    if (!zip) {
      setError("Attach the project's .zip file");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const body = new FormData();
      body.append("file", zip);
      body.append("name", form.name.trim());
      body.append("description", form.description.trim());
      if (form.project) body.append("project", form.project);
      body.append("operationsManagers", JSON.stringify(leaders));
      body.append("employees", JSON.stringify(employees));
      body.append("canEdit", String(form.canEdit));
      body.append("canCreateDelete", String(form.canCreateDelete));
      body.append("canRun", String(form.canRun));

      const { data } = await adminApi.post("/admin/code-projects", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onCreated?.(data.message || "Project created");
      close();
    } catch (err) {
      setError(err.response?.data?.message || "Could not create the project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create code project"
      subtitle="Upload the archive and choose who works on it"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSave}>
            {saving ? "Extracting…" : "Create"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Alert>{error}</Alert>

        {/* the archive */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project archive
          </h4>

          {zip ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{zip.name}</p>
                <p className="text-xs text-slate-500">{formatSize(zip.size)}</p>
              </div>
              <button
                type="button"
                onClick={clearZip}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-white hover:text-red-600"
              >
                Change
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-7 text-center transition-colors hover:border-blue-500 hover:bg-blue-50/40">
              <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={20} />
              </span>
              <span className="text-sm font-medium text-slate-800">Choose the project ZIP</span>
              <span className="text-xs text-slate-500">
                Only .zip · up to {MAX_UPLOAD_MB} MB · node_modules is skipped automatically
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={pickZip}
                className="hidden"
              />
            </label>
          )}
        </section>

        {/* details */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project name" required className="sm:col-span-2">
            <Input
              name="name"
              value={form.name}
              onChange={change}
              placeholder="E-Commerce Website"
            />
          </Field>

          <Field label="Description" className="sm:col-span-2">
            <Textarea
              name="description"
              value={form.description}
              onChange={change}
              placeholder="Company E-Commerce Project"
            />
          </Field>

          <Field
            label="Link to a project"
            hint="Optional — ties this code to an existing project record"
            className="sm:col-span-2"
          >
            <Select
              name="project"
              value={form.project}
              onChange={change}
              options={lookups.projectOptions}
              placeholder="Not linked"
            />
          </Field>
        </section>

        {/* who works on it */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assign to
          </h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Operations Managers" hint={`${leaders.length} selected`}>
              <MultiSelect
                options={leaderOptions}
                value={leaders}
                onChange={setLeaders}
                emptyLabel="No operations managers on record"
                height="max-h-36"
              />
            </Field>

            <Field label="Employees" hint={`${employees.length} selected`}>
              <MultiSelect
                options={employeeOptions}
                value={employees}
                onChange={setEmployees}
                emptyLabel="No employees on record"
                height="max-h-36"
              />
            </Field>
          </div>

          <div className="mt-2">
            <ChipList
              items={[...pickedLeaders, ...pickedEmployees]}
              onRemove={(id) => {
                setLeaders((prev) => prev.filter((v) => v !== id));
                setEmployees((prev) => prev.filter((v) => v !== id));
              }}
              empty="Nobody assigned yet — you can assign later."
            />
          </div>
        </section>

        {/* what they may do */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What assigned staff may do
          </h4>

          <div className="space-y-2">
            {PERMISSIONS.map((perm) => (
              <label
                key={perm.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={form[perm.key]}
                  onChange={() => toggle(perm.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{perm.label}</span>
                  <span className="block text-xs text-slate-500">{perm.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- assign */

const PERMISSIONS = [
  { key: "canEdit", label: "Edit code", hint: "Open files and save changes" },
  { key: "canCreateDelete", label: "Create & delete files", hint: "Add, rename or remove files" },
  { key: "canRun", label: "Run & preview", hint: "Start the project and see its output" },
];

/** Change who works on an existing project, and what they may do. */
function AssignModal({ project, onClose, onSaved }) {
  const lookups = useLookups();

  const [leaders, setLeaders] = useState((project.operationsManagers || []).map((p) => p._id));
  const [employees, setEmployees] = useState((project.employees || []).map((p) => p._id));
  const [permissions, setPermissions] = useState({
    canEdit: project.permissions?.canEdit !== false,
    canCreateDelete: project.permissions?.canCreateDelete === true,
    canRun: project.permissions?.canRun !== false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const leaderOptions = lookups.operationsManagers.map((p) => ({ value: p._id, label: p.name }));
  const employeeOptions = lookups.employees.map((p) => ({ value: p._id, label: p.name }));

  const picked = [
    ...leaderOptions.filter((o) => leaders.includes(o.value)),
    ...employeeOptions.filter((o) => employees.includes(o.value)),
  ];

  // Only people who were not already on the project get a notification
  const before = new Set(
    [...(project.operationsManagers || []), ...(project.employees || [])].map((p) => p._id)
  );
  const newcomers = picked.filter((p) => !before.has(p.value)).length;

  const save = async () => {
    setSaving(true);
    setError("");

    try {
      const { data } = await adminApi.put(`/admin/code-projects/${project._id}`, {
        operationsManagers: leaders,
        employees,
        permissions,
      });
      onSaved?.(data.message || "Assignment updated");
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the assignment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`Assign — ${project.name}`}
      subtitle="Only the people named here can open this project"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert>{error}</Alert>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Operations Managers" hint={`${leaders.length} selected`}>
            <MultiSelect
              options={leaderOptions}
              value={leaders}
              onChange={setLeaders}
              emptyLabel="No operations managers on record"
              height="max-h-36"
            />
          </Field>

          <Field label="Employees" hint={`${employees.length} selected`}>
            <MultiSelect
              options={employeeOptions}
              value={employees}
              onChange={setEmployees}
              emptyLabel="No employees on record"
              height="max-h-36"
            />
          </Field>
        </div>

        <ChipList
          items={picked}
          onRemove={(id) => {
            setLeaders((prev) => prev.filter((v) => v !== id));
            setEmployees((prev) => prev.filter((v) => v !== id));
          }}
          empty="Nobody assigned — the project will be admin-only."
        />

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What assigned staff may do
          </h4>
          <div className="space-y-2">
            {PERMISSIONS.map((perm) => (
              <label
                key={perm.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={permissions[perm.key]}
                  onChange={() =>
                    setPermissions((prev) => ({ ...prev, [perm.key]: !prev[perm.key] }))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{perm.label}</span>
                  <span className="block text-xs text-slate-500">{perm.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {newcomers > 0 && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 ring-1 ring-inset ring-blue-100">
            {newcomers} new {newcomers === 1 ? "person" : "people"} will be notified. Anyone already
            on the project is not notified again.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- file tree */

function TreeNode({ node, depth }) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === "file") {
    return (
      <div
        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <FileCode2 size={13} className="shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-slate-400">
          {formatSize(node.size)}
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Folder size={13} className="shrink-0 text-blue-500" />
        <span className="truncate">{node.name}</span>
        {node.collapsed && <span className="text-[10px] text-slate-400">(not extracted)</span>}
      </button>

      {open &&
        node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function FileTreeModal({ project, onClose }) {
  const [state, setState] = useState({ loading: true, tree: [], truncated: false, error: "" });

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/code-projects/${project._id}/tree`)
      .then(({ data }) => {
        if (!active) return;
        setState({ loading: false, tree: data.tree || [], truncated: data.truncated, error: "" });
      })
      .catch((err) => {
        if (!active) return;
        setState({
          loading: false,
          tree: [],
          truncated: false,
          error: err.response?.data?.message || "Could not read the file tree",
        });
      });

    return () => {
      active = false;
    };
  }, [project._id]);

  return (
    <Modal
      open
      title={project.name}
      subtitle={`${project.fileCount} files · ${project.stack} · extracted from ${project.zipOriginalName}`}
      onClose={onClose}
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Alert>{state.error}</Alert>

      {state.loading ? (
        <Loader label="Reading the project…" />
      ) : (
        <>
          {state.truncated && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
              This project is very large — the tree below is capped.
            </p>
          )}
          <div className="max-h-[26rem] overflow-auto rounded-lg border border-slate-200 py-1">
            {state.tree.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Read-only for now. Editing, saving and preview arrive with the workspace.
          </p>
        </>
      )}
    </Modal>
  );
}
