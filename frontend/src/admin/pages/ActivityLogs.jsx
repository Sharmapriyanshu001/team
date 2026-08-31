import { useCrud } from "../hooks/crud";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import { Alert, Badge, Card, PageHeader } from "../../shared/components/ui";

const ACTION_TONES = {
  created: "blue",
  updated: "sky",
  deleted: "red",
  login: "black",
};

const ENTITIES = ["Client", "Project", "Task", "Issue", "Employee", "Team Leader", "File", "Role", "Settings", "Admin"];

export default function ActivityLogs() {
  const crud = useCrud("activity-logs", { limit: 50 });

  const columns = [
    {
      key: "action",
      header: "Action",
      render: (row) => <Badge tone={ACTION_TONES[row.action] || "slate"}>{row.action}</Badge>,
    },
    { key: "entity", header: "Module", render: (row) => row.entity || "—" },
    {
      key: "message",
      header: "Details",
      render: (row) => <span className="text-slate-700">{row.message || "—"}</span>,
    },
    { key: "actorName", header: "By", render: (row) => row.actorName || "System" },
    {
      key: "createdAt",
      header: "When",
      render: (row) => (
        <span className="whitespace-nowrap text-slate-500">
          {new Date(row.createdAt).toLocaleString("en-IN")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Activity Logs"
        subtitle={`${crud.total} actions recorded across the panel`}
      />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by message or user"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "action",
              value: crud.filters.action,
              placeholder: "All actions",
              options: ["created", "updated", "deleted", "login"],
            },
            {
              key: "entity",
              value: crud.filters.entity,
              placeholder: "All modules",
              options: ENTITIES,
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
          emptyTitle="No activity yet"
          emptyMessage="Every create, update and delete in the panel is recorded here."
        />
      </Card>
    </div>
  );
}
