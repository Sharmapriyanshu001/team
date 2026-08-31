import { useRef, useState } from "react";
import { FileArchive, X } from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Button,
  ChipList,
  Field,
  Input,
  MultiSelect,
  Select,
  Textarea,
} from "../../../shared/components/ui";

const PRIORITIES = ["low", "medium", "high"];

const ROLES = [
  { value: "team_leader", label: "Team Leaders" },
  { value: "employee", label: "Employees" },
];

const MAX_UPLOAD_MB = 50;

const EMPTY = {
  title: "",
  description: "",
  project: "",
  priority: "medium",
  dueDate: "",
  assignmentNote: "",
};

// The date input's own floor, so yesterday cannot be picked at all. Built from
// local parts rather than toISOString(), which would shift the day in IST.
const todayValue = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const prettySize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Hand one piece of work to any number of team leaders and employees at once,
 * with an optional ZIP travelling with it.
 *
 * The role buttons only filter the list — a tick survives switching sides, so
 * two leaders and three employees can go out in a single assignment. Everyone
 * picked gets their own task, and their own copy of the archive.
 */
export default function AssignTaskModal({ open, onClose, onAssigned }) {
  const lookups = useLookups();
  const fileInput = useRef(null);

  const [form, setForm] = useState(EMPTY);
  const [assignees, setAssignees] = useState([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [zip, setZip] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const today = todayValue();

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  /* --------------------------------------------------------------- people */

  // One list, both sides, each option remembering which side it came from
  const everyone = [
    ...lookups.teamLeaders.map((person) => ({
      value: person._id,
      label: person.name,
      role: "team_leader",
      group: "Team Leaders",
    })),
    ...lookups.employees.map((person) => ({
      value: person._id,
      label: person.name,
      role: "employee",
      group: "Employees",
    })),
  ];

  const visible = roleFilter ? everyone.filter((p) => p.role === roleFilter) : everyone;
  const picked = everyone.filter((p) => assignees.includes(p.value));

  /* ----------------------------------------------------------------- zip */

  const pickZip = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.zip$/i.test(file.name)) {
      setError("Only a .zip file can be attached");
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
  };

  const clearZip = () => {
    setZip(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  /* ---------------------------------------------------------------- save */

  const close = () => {
    setForm(EMPTY);
    setAssignees([]);
    setRoleFilter("");
    clearZip();
    setError("");
    onClose();
  };

  const handleSave = async (e) => {
    e?.preventDefault();

    if (!assignees.length) {
      setError("Pick at least one team leader or employee");
      return;
    }
    if (!form.title.trim()) {
      setError("Write what the work is");
      return;
    }
    if (form.dueDate && form.dueDate < today) {
      setError("The due date cannot be before today");
      return;
    }

    setSaving(true);
    setError("");

    try {
      // Multipart either way — the endpoint takes the ZIP as an optional part
      const body = new FormData();
      body.append("title", form.title.trim());
      body.append("description", form.description.trim());
      body.append("priority", form.priority);
      body.append("assignmentNote", form.assignmentNote.trim());
      if (form.project) body.append("project", form.project);
      if (form.dueDate) body.append("dueDate", form.dueDate);
      body.append(
        "assignees",
        JSON.stringify(picked.map((person) => ({ id: person.value, role: person.role })))
      );
      if (zip) body.append("file", zip);

      const { data } = await adminApi.post("/admin/assign-work", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onAssigned?.(data.message || `Work assigned to ${picked.length} people`);
      close();
    } catch (err) {
      setError(err.response?.data?.message || "Could not assign the work");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Assign work"
      subtitle="Give one task to any number of team leaders and employees"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSave}>
            {assignees.length > 1 ? `Assign to ${assignees.length}` : "Assign"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-5">
        <Alert>{error}</Alert>

        {/* who it goes to */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assign to
          </h4>

          <div className="mb-3 flex flex-wrap gap-2">
            {[{ value: "", label: "Everyone" }, ...ROLES].map((role) => (
              <button
                key={role.value || "all"}
                type="button"
                onClick={() => setRoleFilter(role.value)}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  roleFilter === role.value
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>

          <Field
            required
            hint={
              everyone.length
                ? "Tick as many as you like — the buttons above only filter the list"
                : "Nobody on record yet — add them under Staff first"
            }
          >
            <MultiSelect
              options={visible}
              value={assignees}
              onChange={setAssignees}
              placeholder="Search by name…"
              emptyLabel="Nobody on record yet"
            />
          </Field>

          <div className="mt-2">
            <ChipList
              items={picked}
              onRemove={(id) => setAssignees((prev) => prev.filter((v) => v !== id))}
              empty="Nobody picked yet."
            />
          </div>
        </section>

        {/* the work itself */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            The work
          </h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Task" required className="sm:col-span-2">
              <Input
                name="title"
                value={form.title}
                onChange={change}
                placeholder="Review the site drawings pack"
              />
            </Field>

            <Field label="Project">
              <Select
                name="project"
                value={form.project}
                onChange={change}
                options={lookups.projectOptions}
                placeholder="No project"
              />
            </Field>

            <Field label="Priority">
              <Select name="priority" value={form.priority} onChange={change} options={PRIORITIES} />
            </Field>

            <Field label="Due date" hint="Today or later" className="sm:col-span-2">
              <Input
                name="dueDate"
                type="date"
                value={form.dueDate}
                onChange={change}
                min={today}
              />
            </Field>

            <Field label="Details" className="sm:col-span-2">
              <Textarea
                name="description"
                value={form.description}
                onChange={change}
                placeholder="What exactly needs doing"
              />
            </Field>
          </div>
        </section>

        {/* the archive that goes with it */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Attach a ZIP <span className="font-normal normal-case text-slate-400">· optional</span>
          </h4>

          {zip ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{zip.name}</p>
                <p className="text-xs text-slate-500">{prettySize(zip.size)}</p>
              </div>
              <button
                type="button"
                onClick={clearZip}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                aria-label="Remove the attached ZIP"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 transition-colors hover:border-blue-500 hover:bg-blue-50/40">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">Choose a ZIP file</span>
                <span className="block text-xs text-slate-500">
                  Only .zip · up to {MAX_UPLOAD_MB} MB · everyone picked gets their own copy
                </span>
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

          {zip && (
            <Field label="Note with the file" className="mt-3">
              <Input
                name="assignmentNote"
                value={form.assignmentNote}
                onChange={change}
                placeholder="What to do with the archive"
              />
            </Field>
          )}
        </section>
      </form>
    </Modal>
  );
}
