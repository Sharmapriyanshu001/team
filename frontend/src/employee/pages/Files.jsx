import { useState } from "react";
import { ExternalLink, FileText, FileArchive, Download, CircleCheck } from "lucide-react";

import employeeApi from "../employeeApi";
import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { readStoredUser } from "../../shared/createApi";
import { prettify } from "../../shared/format";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal from "../../shared/components/Modal";
import { Alert, Badge, Button, Card, Field, PageHeader, Textarea } from "../../shared/components/ui";

const CATEGORIES = ["contract", "invoice", "design", "report", "other"];

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

export default function Files() {
  const crud = useCrud("files");
  const lookups = useLookups();
  const me = readStoredUser("employee");

  const [downloadingId, setDownloadingId] = useState("");
  const [completing, setCompleting] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const isMine = (row) => row.assignedTo?._id && row.assignedTo._id === me?.id;

  const handleDownload = async (row) => {
    setDownloadingId(row._id);
    try {
      const { data } = await employeeApi.get(`/employee/files/${row._id}/download`, {
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
    setSaving(true);
    setFormError("");

    try {
      const { data } = await employeeApi.put(`/employee/files/${completing._id}/complete`, { note });
      crud.refresh();
      setCompleting(null);
      setNote("");
      setSuccess(data.message || "Marked as completed");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not update the file");
    } finally {
      setSaving(false);
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
          {isMine(row) && row.status !== "completed" && (
            <button
              onClick={() => {
                setCompleting(row);
                setNote("");
                setFormError("");
              }}
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
              title="Mark as completed"
            >
              <CircleCheck size={15} />
            </button>
          )}
          {!row.storedName && !row.url && <span className="text-xs text-slate-400">No link</span>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Files"
        subtitle="Documents on your projects, plus anything assigned to you"
      />

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
          emptyMessage="Files your team adds to your projects will appear here."
        />
      </Card>

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
            <Button loading={saving} onClick={markComplete}>
              Mark completed
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        {completing?.assignmentNote && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Admin&apos;s note: {completing.assignmentNote}
          </p>
        )}

        <Field label="What did you do?" hint="The admin sees this on their Files page">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Unpacked and applied the drawings to the site plan"
          />
        </Field>
      </Modal>
    </div>
  );
}
