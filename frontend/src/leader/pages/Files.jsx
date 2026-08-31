import { useState } from "react";
import {
  Plus,
  Trash2,
  ExternalLink,
  FileText,
  FileArchive,
  Download,
  CircleCheck,
} from "lucide-react";

import leaderApi from "../leaderApi";
import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { prettify } from "../../shared/format";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
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
  Textarea,
} from "../../shared/components/ui";

const CATEGORIES = ["contract", "invoice", "design", "report", "other"];

const EMPTY = { title: "", url: "", category: "design", fileType: "pdf", size: 0, project: "" };

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

export default function Files() {
  const crud = useCrud("files");
  const lookups = useLookups();
  const leader = JSON.parse(localStorage.getItem("leader") || "null");

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [downloadingId, setDownloadingId] = useState("");
  const [completing, setCompleting] = useState(null);
  const [note, setNote] = useState("");
  const [completeSaving, setCompleteSaving] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [success, setSuccess] = useState("");

  const isMine = (row) => row.assignedTo?._id && row.assignedTo._id === leader?.id;

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleDownload = async (row) => {
    setDownloadingId(row._id);
    try {
      const { data } = await leaderApi.get(`/leader/files/${row._id}/download`, {
        responseType: "blob",
      });

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = row.originalName || `${row.title}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      // Downloading moves the file's status on, so the row is stale now
      crud.refresh();
    } catch {
      crud.setError("Could not download the file");
    } finally {
      setDownloadingId("");
    }
  };

  const markComplete = async () => {
    setCompleteSaving(true);
    setCompleteError("");

    try {
      const { data } = await leaderApi.put(`/leader/files/${completing._id}/complete`, { note });
      crud.refresh();
      setCompleting(null);
      setNote("");
      setSuccess(data.message || "Marked as completed");
    } catch (err) {
      setCompleteError(err.response?.data?.message || "Could not update the file");
    } finally {
      setCompleteSaving(false);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await crud.create({ ...form, size: Number(form.size) || 0 });
      setAdding(false);
      setForm(EMPTY);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add the file");
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
      crud.setError(err.response?.data?.message || "Could not remove the file");
    } finally {
      setDeleting(false);
    }
  };

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
    { key: "project", header: "Project", render: (row) => row.project?.name || "—" },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (row) =>
        row.assignedTo ? (
          <span className={isMine(row) ? "font-medium text-slate-900" : "text-slate-700"}>
            {isMine(row) ? "You" : row.assignedTo.name}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (row.assignedTo ? <Badge value={row.status} /> : "—"),
    },
    { key: "uploadedBy", header: "Added by", render: (row) => row.uploadedBy?.name || "Admin" },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        const mine = row.uploadedBy?._id === leader?.id;
        return (
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
              >
                <ExternalLink size={15} />
              </a>
            )}
            {isMine(row) && row.status !== "completed" && (
              <button
                onClick={() => {
                  setCompleting(row);
                  setNote("");
                  setCompleteError("");
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                title="Mark as completed"
              >
                <CircleCheck size={15} />
              </button>
            )}
            {mine && (
              <button
                onClick={() => setTarget(row)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Remove"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Files"
        subtitle={`${crud.total} documents across your projects`}
      >
        <Button onClick={() => setAdding(true)}>
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
              key: "view",
              value: crud.filters.view,
              placeholder: "All files",
              options: [{ value: "assigned", label: "Assigned to me" }],
            },
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "Any status",
              options: ["assigned", "downloaded", "completed"].map((s) => ({
                value: s,
                label: prettify(s),
              })),
            },
            {
              key: "category",
              value: crud.filters.category,
              placeholder: "All categories",
              options: CATEGORIES.map((c) => ({ value: c, label: prettify(c) })),
            },
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
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
          emptyMessage="Drawings, reports and site photos for your projects live here."
        />
      </Card>

      <Modal
        open={adding}
        title="Add file"
        subtitle="Store a link to the document against one of your projects"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>
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
            <Input
              name="title"
              value={form.title}
              onChange={change}
              required
              placeholder="Revised foundation drawing.pdf"
            />
          </Field>

          <Field label="File URL" className="sm:col-span-2" hint="Link to the file in your drive">
            <Input name="url" value={form.url} onChange={change} placeholder="https://..." />
          </Field>

          <Field label="Project" required>
            <Select
              name="project"
              value={form.project}
              onChange={change}
              required
              placeholder="Select a project"
              options={lookups.projectOptions}
            />
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
            />
          </Field>

          <Field label="Size (KB)">
            <Input
              type="number"
              min="0"
              value={form.size ? Math.round(form.size / 1024) : ""}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, size: (Number(e.target.value) || 0) * 1024 }))
              }
              placeholder="512"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(completing)}
        size="sm"
        title="Mark as completed"
        subtitle={completing?.title}
        onClose={() => setCompleting(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button loading={completeSaving} onClick={markComplete}>
              Mark completed
            </Button>
          </>
        }
      >
        <Alert>{completeError}</Alert>

        {completing?.assignmentNote && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Admin&apos;s note: {completing.assignmentNote}
          </p>
        )}

        <Field label="What did you do?" hint="The admin sees this on their Files page">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reviewed the pack and passed it to the site team"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Remove file"
        message={`Remove "${target?.title}"? Only files you added can be removed.`}
        loading={deleting}
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
