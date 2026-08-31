import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Mail, Phone, Eye } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import ProfileDetail from "../../components/ProfileDetail";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card, PageHeader } from "../../../shared/components/ui";

const initialsOf = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Shared list screen for "All Team Leaders" and "All Employees". */
export default function StaffList({ resource, title, subtitle, addPath, showTeamLeader }) {
  const navigate = useNavigate();
  const crud = useCrud(resource);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Row that is open in the profile drawer
  const [viewing, setViewing] = useState(null);

  const roleLabel = resource === "team-leaders" ? "Team leader" : "Employee";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete this record");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Name",
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
    ...(showTeamLeader
      ? [
          {
            key: "reportsTo",
            header: "Reports to",
            render: (row) => row.reportsTo?.name || "—",
          },
        ]
      : []),
    {
      key: "joiningDate",
      header: "Joined",
      render: (row) =>
        row.joiningDate ? new Date(row.joiningDate).toLocaleDateString("en-IN") : "—",
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      // Stop the click bubbling, otherwise the row also opens the profile
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
            onClick={() => navigate(`${addPath}?id=${row._id}`)}
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
      <PageHeader title={title} subtitle={subtitle || `${crud.total} people on record`}>
        <Link to={addPath}>
          <Button>
            <Plus size={15} />
            Add
          </Button>
        </Link>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name, email, designation or department"
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
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={setViewing}
          emptyTitle="Nobody here yet"
          emptyMessage="Add team members to assign them to projects and tasks."
        />
      </Card>

      <ProfileDetail
        open={Boolean(viewing)}
        resource={resource}
        id={viewing?._id}
        roleLabel={roleLabel}
        onClose={() => setViewing(null)}
        onEdit={(id) => navigate(`${addPath}?id=${id}`)}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete record"
        message={`Delete "${target?.name}"? Their tasks will stay but become unassigned.`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
