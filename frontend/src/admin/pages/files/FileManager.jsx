import { useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  FileText,
  FileArchive,
  Download,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";

import adminApi from "../../adminApi";
import AssignTaskModal from "./AssignTaskModal";
import { useCrud } from "../../hooks/crud";
import { prettify } from "../../../shared/format";
import useLookups from "../../hooks/useLookups";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

const CATEGORIES = ["contract", "invoice", "design", "report", "other"];
const STATUSES = ["available", "assigned", "downloaded", "completed"];

// Kept in step with MAX_UPLOAD_BYTES on the server
const MAX_UPLOAD_MB = 50;

const ASSIGN_ROLES = [
  { value: "team_leader", label: "Team Leader" },
  { value: "employee", label: "Employee" },
];

const EMPTY_UPLOAD = {
  title: "",
  client: "",
  project: "",
  category: "other",
  description: "",
  assignedRole: "",
  assignedTo: "",
  assignmentNote: "",
};

const EMPTY_EDIT = {
  title: "",
  url: "",
  category: "other",
  fileType: "pdf",
  size: 0,
  client: "",
  project: "",
  description: "",
};

const EMPTY_ASSIGN = { assignedRole: "", assignedTo: "", assignmentNote: "" };

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

/** Shared by "Clients > Documents" and the global "Files" section. */
export default function FileManager({
  title,
  subtitle,
  showClientColumn = true,
  // "Assign Work" only belongs on the internal Files screen, not on the
  // client-facing document list.
  showAssignTask = false,
}) {
  const crud = useCrud("files");
  const lookups = useLookups();
  const fileInput = useRef(null);

  // Upload
  const [uploadOpen, setUploadOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Edit details
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Assign / reassign
  const [assigning, setAssigning] = useState(null);
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGN);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [success, setSuccess] = useState("");
  const [assignTaskOpen, setAssignTaskOpen] = useState(false);

  /* ---------------------------------------------------------------- upload */

  const openUpload = () => {
    setPicked(null);
    setUploadForm(EMPTY_UPLOAD);
    setUploadError("");
    setSuccess("");
    setUploadOpen(true);
  };

  const changeUpload = (e) =>
    setUploadForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // Switching between team leader and employee clears the person already picked
  const pickRole = (role) =>
    setUploadForm((prev) => ({
      ...prev,
      assignedRole: prev.assignedRole === role ? "" : role,
      assignedTo: "",
    }));

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");

    if (!/\.zip$/i.test(file.name)) {
      setPicked(null);
      setUploadError("Only .zip files can be uploaded");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setPicked(null);
      setUploadError(`"${file.name}" is ${formatSize(file.size)} — the limit is ${MAX_UPLOAD_MB} MB`);
      return;
    }

    setPicked(file);
    // Default the title to the archive name until the admin types their own
    setUploadForm((prev) => ({ ...prev, title: prev.title || file.name.replace(/\.zip$/i, "") }));
  };

  const clearFile = () => {
    setPicked(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleUpload = async (e) => {
    e?.preventDefault();

    if (!picked) {
      setUploadError("Choose a .zip file to upload");
      return;
    }
    if (uploadForm.assignedRole && !uploadForm.assignedTo) {
      setUploadError("Pick the person this file is assigned to");
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const body = new FormData();
      body.append("file", picked);
      Object.entries(uploadForm).forEach(([key, value]) => value && body.append(key, value));

      const { data } = await adminApi.post("/admin/files/upload", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      crud.refresh();
      setUploadOpen(false);
      clearFile();
      setUploadForm(EMPTY_UPLOAD);
      setSuccess(data.message || "File uploaded");
    } catch (err) {
      setUploadError(err.response?.data?.message || "Could not upload the file");
    } finally {
      setUploading(false);
    }
  };

  /* ------------------------------------------------------------ edit details */

  const openEdit = (row) => {
    setForm({
      title: row.title,
      url: row.url || "",
      category: row.category,
      fileType: row.fileType || "",
      size: row.size || 0,
      client: row.client?._id || "",
      project: row.project?._id || "",
      description: row.description || "",
    });
    setFormError("");
    setEditing(row);
  };

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await crud.update(editing._id, { ...form, size: Number(form.size) || 0 });
      setEditing(null);
      setSuccess("File details saved");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save the file");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------------- assign */

  const openAssign = (row) => {
    setAssignForm({
      assignedRole: row.assignedRole || "",
      assignedTo: row.assignedTo?._id || "",
      assignmentNote: row.assignmentNote || "",
    });
    setAssignError("");
    setAssigning(row);
  };

  const handleAssign = async () => {
    setAssignSaving(true);
    setAssignError("");

    try {
      const { data } = await adminApi.put(`/admin/files/${assigning._id}/assign`, assignForm);
      crud.refresh();
      setAssigning(null);
      setSuccess(data.message || "Assignment updated");
    } catch (err) {
      setAssignError(err.response?.data?.message || "Could not assign the file");
    } finally {
      setAssignSaving(false);
    }
  };

  /* -------------------------------------------------------------- download */

  const handleDownload = async (row) => {
    setDownloadingId(row._id);
    try {
      const { data } = await adminApi.get(`/admin/files/${row._id}/download`, {
        responseType: "blob",
      });
      saveBlob(data, row.originalName || `${row.title}.zip`);
    } catch {
      crud.setError("Could not download the file");
    } finally {
      setDownloadingId("");
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete the file");
    } finally {
      setDeleting(false);
    }
  };

  /* --------------------------------------------------------------- columns */

  const peopleOptions =
    uploadForm.assignedRole === "team_leader" ? lookups.leaderOptions : lookups.employeeOptions;

  const assignPeopleOptions =
    assignForm.assignedRole === "team_leader" ? lookups.leaderOptions : lookups.employeeOptions;

  const columns = [
    {
      key: "title",
      header: "File",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            {row.storedName ? <FileArchive size={15} /> : <FileText size={15} />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.title}</p>
            <p className="text-xs text-slate-400">
              {(row.fileType || "file").toUpperCase()} · {formatSize(row.size)}
            </p>
          </div>
        </div>
      ),
    },
    { key: "category", header: "Category", render: (row) => <Badge value={row.category} /> },
    ...(showClientColumn
      ? [
          {
            key: "client",
            header: "Client",
            render: (row) => row.client?.company || row.client?.name || "—",
          },
        ]
      : []),
    { key: "project", header: "Project", render: (row) => row.project?.name || "—" },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (row) =>
        row.assignedTo ? (
          <div>
            <p className="text-slate-900">{row.assignedTo.name}</p>
            <p className="text-xs text-slate-400">{prettify(row.assignedRole)}</p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Nobody</span>
        ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "createdAt",
      header: "Uploaded",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.storedName && (
            <button
              onClick={() => handleDownload(row)}
              disabled={downloadingId === row._id}
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40"
              title="Download"
            >
              <Download size={15} />
            </button>
          )}
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
              title="Open link"
            >
              <ExternalLink size={15} />
            </a>
          )}
          <button
            onClick={() => openAssign(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            title="Assign"
          >
            <UserCheck size={15} />
          </button>
          <button
            onClick={() => openEdit(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            title="Edit details"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setTarget(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle || `${crud.total} files stored`}>
        {showAssignTask && (
          <Button
            variant="outline"
            onClick={() => {
              setSuccess("");
              setAssignTaskOpen(true);
            }}
          >
            <UserPlus size={15} />
            Assign Work
          </Button>
        )}
        <Button onClick={openUpload}>
          <Plus size={15} />
          Add File
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>
      <Alert tone="success">{success}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search files"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "category",
              value: crud.filters.category,
              placeholder: "All categories",
              options: CATEGORIES.map((c) => ({ value: c, label: prettify(c) })),
            },
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: STATUSES.map((s) => ({ value: s, label: prettify(s) })),
            },
            {
              key: "client",
              value: crud.filters.client,
              placeholder: "All clients",
              options: lookups.clientOptions,
            },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          emptyTitle="No files yet"
          emptyMessage="Upload a ZIP and assign it, or attach contracts, invoices and reports here."
        />
      </Card>

      {/* ---------------------------------------------------------- upload */}
      <Modal
        open={uploadOpen}
        size="lg"
        title="Add file"
        subtitle="Upload a ZIP, file it against a project and hand it to one person"
        onClose={() => setUploadOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button loading={uploading} onClick={handleUpload}>
              {uploadForm.assignedTo ? "Upload & Assign" : "Upload"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleUpload} className="space-y-6">
          <Alert>{uploadError}</Alert>

          {/* file */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              File
            </h4>

            {picked ? (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FileArchive size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{picked.name}</p>
                  <p className="text-xs text-slate-500">ZIP · {formatSize(picked.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                  title="Remove"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center transition-colors hover:border-blue-500 hover:bg-blue-50/40">
                <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-white text-blue-600 ring-1 ring-slate-200">
                  <FileArchive size={20} />
                </span>
                <span className="text-sm font-medium text-slate-800">Choose a ZIP file</span>
                <span className="text-xs text-slate-500">
                  Only .zip is accepted · up to {MAX_UPLOAD_MB} MB
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={pickFile}
                  className="hidden"
                />
              </label>
            )}
          </section>

          {/* project details */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Project details
            </h4>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2" hint="Defaults to the file name">
                <Input
                  name="title"
                  value={uploadForm.title}
                  onChange={changeUpload}
                  placeholder="Site drawings pack"
                />
              </Field>

              <Field label="Client">
                <Select
                  name="client"
                  value={uploadForm.client}
                  onChange={changeUpload}
                  options={lookups.clientOptions}
                  placeholder="No client"
                />
              </Field>

              <Field label="Project">
                <Select
                  name="project"
                  value={uploadForm.project}
                  onChange={changeUpload}
                  options={lookups.projectOptions}
                  placeholder="No project"
                />
              </Field>

              <Field label="Category">
                <Select
                  name="category"
                  value={uploadForm.category}
                  onChange={changeUpload}
                  options={CATEGORIES.map((c) => ({ value: c, label: prettify(c) }))}
                />
              </Field>

              <Field label="Notes" className="sm:col-span-2">
                <Textarea
                  name="description"
                  value={uploadForm.description}
                  onChange={changeUpload}
                  placeholder="What is inside this archive"
                />
              </Field>
            </div>
          </section>

          {/* assignment */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assign work
            </h4>

            <div className="mb-3 flex flex-wrap gap-2">
              {ASSIGN_ROLES.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => pickRole(role.value)}
                  className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                    uploadForm.assignedRole === role.value
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {role.label}
                </button>
              ))}
            </div>

            {uploadForm.assignedRole ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={uploadForm.assignedRole === "team_leader" ? "Team leader" : "Employee"}
                  required
                >
                  <Select
                    name="assignedTo"
                    value={uploadForm.assignedTo}
                    onChange={changeUpload}
                    options={peopleOptions}
                    placeholder={
                      peopleOptions.length ? "Select one person" : "Nobody available yet"
                    }
                  />
                </Field>

                <Field label="Note for them">
                  <Input
                    name="assignmentNote"
                    value={uploadForm.assignmentNote}
                    onChange={changeUpload}
                    placeholder="What they need to do with it"
                  />
                </Field>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Optional — pick Team Leader or Employee to make one person responsible for this
                file. Leave it as it is to simply store the file.
              </p>
            )}
          </section>
        </form>
      </Modal>

      {/* ------------------------------------------------------------ edit */}
      <Modal
        open={Boolean(editing)}
        title="Edit file"
        subtitle="Update the details — the archive itself stays as it is"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Alert>{formError}</Alert>

          <Field label="Title" required className="sm:col-span-2">
            <Input name="title" value={form.title} onChange={change} required placeholder="Signed contract.pdf" />
          </Field>

          {!editing?.storedName && (
            <Field label="File URL" className="sm:col-span-2" hint="Link to the file in your storage or drive">
              <Input name="url" value={form.url} onChange={change} placeholder="https://..." />
            </Field>
          )}

          <Field label="Notes" className="sm:col-span-2">
            <Textarea name="description" value={form.description} onChange={change} />
          </Field>

          <Field label="Category">
            <Select
              name="category"
              value={form.category}
              onChange={change}
              options={CATEGORIES.map((c) => ({ value: c, label: prettify(c) }))}
            />
          </Field>

          <Field label="File type">
            <Select
              name="fileType"
              value={form.fileType}
              onChange={change}
              options={["pdf", "docx", "xlsx", "dwg", "jpg", "png", "zip"]}
              disabled={Boolean(editing?.storedName)}
            />
          </Field>

          <Field label="Client">
            <Select
              name="client"
              value={form.client}
              onChange={change}
              options={lookups.clientOptions}
              placeholder="No client"
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

          {!editing?.storedName && (
            <Field label="Size (KB)">
              <Input
                name="size"
                type="number"
                min="0"
                value={form.size ? Math.round(form.size / 1024) : ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, size: (Number(e.target.value) || 0) * 1024 }))
                }
                placeholder="512"
              />
            </Field>
          )}
        </form>
      </Modal>

      {/* ---------------------------------------------------------- assign */}
      <Modal
        open={Boolean(assigning)}
        size="sm"
        title="Assign file"
        subtitle={assigning?.title}
        onClose={() => setAssigning(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button loading={assignSaving} onClick={handleAssign}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{assignError}</Alert>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ASSIGN_ROLES.map((role) => (
              <button
                key={role.value}
                type="button"
                onClick={() =>
                  setAssignForm((prev) => ({
                    ...prev,
                    assignedRole: prev.assignedRole === role.value ? "" : role.value,
                    assignedTo: "",
                  }))
                }
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  assignForm.assignedRole === role.value
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>

          {assignForm.assignedRole ? (
            <>
              <Field label="Responsible person" required>
                <Select
                  value={assignForm.assignedTo}
                  onChange={(e) =>
                    setAssignForm((prev) => ({ ...prev, assignedTo: e.target.value }))
                  }
                  options={assignPeopleOptions}
                  placeholder="Select one person"
                />
              </Field>

              <Field label="Note for them">
                <Input
                  value={assignForm.assignmentNote}
                  onChange={(e) =>
                    setAssignForm((prev) => ({ ...prev, assignmentNote: e.target.value }))
                  }
                  placeholder="What they need to do with it"
                />
              </Field>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              No role selected — saving now takes the file back off{" "}
              {assigning?.assignedTo?.name || "whoever has it"} and clears its status.
            </p>
          )}
        </div>
      </Modal>

      <AssignTaskModal
        open={assignTaskOpen}
        onClose={() => setAssignTaskOpen(false)}
        onAssigned={setSuccess}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete file"
        message={`Remove "${target?.title}" from the panel?${
          target?.storedName ? " The uploaded archive is deleted too." : ""
        }`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
