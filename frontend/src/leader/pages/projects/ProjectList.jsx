import { useNavigate } from "react-router-dom";
import { Eye, CalendarDays } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { Alert, Badge, Button, Card, PageHeader, ProgressBar } from "../../../shared/components/ui";

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
      key: "members",
      header: "Team",
      render: (row) => `${row.members?.length || 0} members`,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    {
      key: "endDate",
      header: "Deadline",
      render: (row) => {
        const overdue =
          row.endDate && new Date(row.endDate) < new Date() && row.status !== "completed";
        return (
          <span className={overdue ? "font-medium text-red-600" : ""}>{fmt(row.endDate)}</span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/leader/projects/details?id=${row._id}`)}
        >
          <Eye size={14} />
          Details
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle || `${crud.total} projects`}>
        <Button variant="outline" onClick={() => navigate("/team-leader/progress")}>
          <CalendarDays size={15} />
          Progress board
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search your projects"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "priority",
              value: crud.filters.priority,
              placeholder: "All priorities",
              options: ["low", "medium", "high"],
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
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
        />
      </Card>
    </div>
  );
}
