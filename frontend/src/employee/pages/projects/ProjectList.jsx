import { useNavigate } from "react-router-dom";

import { useCrud } from "../../hooks/crud";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { Alert, Badge, Card, PageHeader, ProgressBar } from "../../../shared/components/ui";

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

/** Shared by "Active Projects" and "Completed Projects". */
export default function ProjectList({ view, title, subtitle, emptyTitle, emptyMessage }) {
  const navigate = useNavigate();
  const crud = useCrud("projects", { initialFilters: { view } });

  const columns = [
    {
      key: "name",
      header: "Project",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.code || "—"}</p>
        </div>
      ),
    },
    {
      key: "client",
      header: "Client",
      render: (row) => row.client?.company || row.client?.name || "—",
    },
    {
      key: "operationsManager",
      header: "Operations Manager",
      render: (row) => row.operationsManager?.name || "Unassigned",
    },
    {
      /**
       * Who put this employee on the project, and when.
       *
       * The date only shows when it was actually recorded. Memberships made
       * before this was tracked — or by an admin from their own screen — fall
       * back to the project's operations manager, who is answerable for it either
       * way, and say nothing about a date rather than inventing one.
       */
      key: "assignedBy",
      header: "Sent to you by",
      render: (row) =>
        row.assignedBy ? (
          <div>
            <p className="text-slate-700">{row.assignedBy}</p>
            <p className="text-xs text-slate-400">
              {row.assignedAt ? fmt(row.assignedAt) : "date not recorded"}
            </p>
          </div>
        ) : (
          "—"
        ),
    },
    {
      key: "myTasks",
      header: "My work",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {row.myCompleted} done ·{" "}
          <strong className="text-slate-900">{row.myTasks - row.myCompleted} open</strong>
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "progress",
      header: "Project progress",
      render: (row) => <ProgressBar value={row.progress} />,
    },
    {
      key: "endDate",
      header: "Deadline",
      render: (row) => {
        const overdue =
          row.endDate && new Date(row.endDate) < new Date() && row.status !== "completed";
        return <span className={overdue ? "font-medium text-red-600" : ""}>{fmt(row.endDate)}</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle || `${crud.total} projects — open one to see everything on it`}
      />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search your projects"
          onFilter={crud.setFilter}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          // The row is the way in: the brief, the board and any archive the
          // manager sent all live on the project's own screen
          onRowClick={(row) => navigate(`/employee/projects/details?id=${row._id}`)}
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
        />
      </Card>
    </div>
  );
}
