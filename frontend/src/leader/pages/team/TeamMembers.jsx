import { Link } from "react-router-dom";
import { Mail, Phone, BarChart3, MessageSquare } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { Alert, Badge, Button, Card, PageHeader, ProgressBar } from "../../../shared/components/ui";

const initialsOf = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function TeamMembers() {
  const crud = useCrud("team");

  const columns = [
    {
      key: "name",
      header: "Member",
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
            {initialsOf(row.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-400">{row.designation || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Contact",
      render: (row) => (
        <div className="space-y-0.5 text-xs">
          <p className="flex items-center gap-1.5 text-slate-700">
            <Mail size={12} className="text-slate-400" />
            {row.email}
          </p>
          <p className="flex items-center gap-1.5 text-slate-500">
            <Phone size={12} className="text-slate-400" />
            {row.phone || "—"}
          </p>
        </div>
      ),
    },
    { key: "department", header: "Department", render: (row) => row.department || "—" },
    {
      key: "tasks",
      header: "Workload",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {row.tasksCompleted} done · <strong className="text-slate-900">{row.tasksOpen} open</strong>
        </span>
      ),
    },
    {
      key: "completionRate",
      header: "Completion",
      render: (row) => <ProgressBar value={row.completionRate} />,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: () => (
        <Link to="/team-leader/chat/employees">
          <Button size="sm" variant="outline">
            <MessageSquare size={14} />
            Chat
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Team Members" subtitle={`${crud.total} people report to you`}>
        <Link to="/team-leader/team/performance">
          <Button variant="outline">
            <BarChart3 size={15} />
            Performance
          </Button>
        </Link>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search your team"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: ["active", "inactive"],
            },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          emptyTitle="No team members yet"
          emptyMessage="The admin assigns employees to you from the Employees section."
        />
      </Card>
    </div>
  );
}
