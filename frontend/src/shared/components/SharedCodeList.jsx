import { useState } from "react";
import { FileCode, Eye } from "lucide-react";

import DataTable from "./DataTable";
import Toolbar from "./Toolbar";
import CodeViewer from "./CodeViewer";
import { Alert, Badge, Card, PageHeader } from "./ui";

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "php",
  "html",
  "css",
  "sql",
  "json",
  "other",
];

/**
 * "Code shared with me" — identical for the employee and operations manager panels,
 * so both mount this with their own crud hook. The list only ever contains
 * submissions the admin handed to the signed-in user; the server decides that,
 * not this component.
 */
export default function SharedCodeList({
  useCrud,
  resource,
  api,
  base,
  title = "Shared Code",
  subtitle,
}) {
  const crud = useCrud(resource);
  const [viewing, setViewing] = useState(null);

  const columns = [
    {
      key: "title",
      header: "Code",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileCode size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.title}</p>
            <p className="text-xs text-slate-400">
              {row.language} · v{row.approvedVersion} approved
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "submittedBy",
      header: "Author",
      render: (row) => row.submittedBy?.name || "—",
    },
    { key: "project", header: "Project", render: (row) => row.project?.name || "—" },
    {
      key: "canDownload",
      header: "Access",
      render: (row) => (
        <Badge tone={row.canDownload ? "blue" : "slate"}>
          {row.canDownload ? "View + download" : "View only"}
        </Badge>
      ),
    },
    {
      key: "updatedAt",
      header: "Shared",
      render: (row) => new Date(row.updatedAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <button
          onClick={() => setViewing(row._id)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
        >
          <Eye size={14} />
          Open
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle || "Code the admin has given you access to"}
      />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search shared code"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "language",
              value: crud.filters.language,
              placeholder: "All languages",
              options: LANGUAGES.map((l) => ({ value: l, label: l })),
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
          emptyTitle="Nothing shared with you yet"
          emptyMessage="Approved code the admin shares with you will show up here."
        />
      </Card>

      {viewing && (
        <CodeViewer
          key={viewing}
          api={api}
          base={base}
          id={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
