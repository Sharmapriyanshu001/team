import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import { money } from "../../../shared/format";
import useLookups from "../../hooks/useLookups";
import ProjectDetail from "../../components/ProjectDetail";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card, PageHeader, ProgressBar } from "../../../shared/components/ui";

export default function AllProjects() {
  const navigate = useNavigate();
  const crud = useCrud("projects");
  const lookups = useLookups();

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Row that is open in the details drawer
  const [viewing, setViewing] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete the project");
    } finally {
      setDeleting(false);
    }
  };

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
      key: "teamLeader",
      header: "Team leader",
      render: (row) => row.teamLeader?.name || "Unassigned",
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    { key: "budget", header: "Budget", render: (row) => money(row.budget) },
    {
      key: "endDate",
      header: "Deadline",
      render: (row) => (row.endDate ? new Date(row.endDate).toLocaleDateString("en-IN") : "—"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      // Stop the click bubbling, otherwise the row also opens the details
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setViewing(row)}
            title="View full details"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={() => navigate(`/admin/projects/create?id=${row._id}`)}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => setTarget(row)}
            title="Delete"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="All Projects" subtitle={`${crud.total} projects on record`}>
        <Link to="/admin/projects/create">
          <Button>
            <Plus size={15} />
            Create Project
          </Button>
        </Link>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search projects by name or code"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: ["planning", "in_progress", "on_hold", "completed", "cancelled"],
            },
            {
              key: "priority",
              value: crud.filters.priority,
              placeholder: "All priorities",
              options: ["low", "medium", "high"],
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
          onRowClick={setViewing}
          emptyTitle="No projects found"
          emptyMessage="Create a project to start assigning teams and tasks."
        />
      </Card>

      <ProjectDetail
        open={Boolean(viewing)}
        id={viewing?._id}
        onClose={() => setViewing(null)}
        onEdit={(id) => navigate(`/admin/projects/create?id=${id}`)}
        onReview={() => navigate(`/admin/tasks/reviews?project=${viewing._id}`)}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete project"
        message={`Delete "${target?.name}"? Tasks and issues linked to it will remain.`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
