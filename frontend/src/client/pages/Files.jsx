import { ExternalLink, FileText } from "lucide-react";

import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { prettify } from "../../shared/format";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import { Alert, Badge, Card, PageHeader } from "../../shared/components/ui";

const CATEGORIES = ["contract", "invoice", "design", "report", "other"];

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

export default function Files() {
  const crud = useCrud("files");
  const lookups = useLookups();

  const columns = [
    {
      key: "title",
      header: "Document",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileText size={15} />
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
    { key: "category", header: "Type", render: (row) => <Badge value={row.category} /> },
    { key: "project", header: "Project", render: (row) => row.project?.name || "General" },
    {
      key: "createdAt",
      header: "Shared",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            Open
            <ExternalLink size={13} />
          </a>
        ) : (
          <span className="text-xs text-slate-400">No link</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Files"
        subtitle="Contracts, invoices, drawings and reports shared with you"
      />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search documents"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "category",
              value: crud.filters.category,
              placeholder: "All types",
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
          emptyTitle="No documents yet"
          emptyMessage="Anything the team shares with you will show up here."
        />
      </Card>
    </div>
  );
}
