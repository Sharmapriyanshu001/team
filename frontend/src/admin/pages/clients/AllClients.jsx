import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import ProfileDetail from "../../components/ProfileDetail";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card, PageHeader } from "../../../shared/components/ui";

/**
 * Every client on record.
 *
 * Like the staff lists, this screen has two homes: its own page, and the
 * Team & Accounts panel where the heading and the type dropdown belong to the
 * panel. `embedded` drops the heading and moves Add into the toolbar; the two
 * path props let the panel keep its list and its form on one URL.
 */
export default function AllClients({
  embedded = false,
  addPath = "/admin/clients/add",
  editPath,
}) {
  const navigate = useNavigate();
  const editHref = (id) => (editPath ? editPath(id) : `${addPath}?id=${id}`);
  const crud = useCrud("clients");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Row that is open in the profile drawer
  const [viewing, setViewing] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete client");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Client",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.company || "—"}</p>
        </div>
      ),
    },
    {
      key: "email",
      header: "Contact",
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.email}</p>
          <p className="text-xs text-slate-400">{row.phone || "—"}</p>
        </div>
      ),
    },
    { key: "address", header: "Location", render: (row) => row.address || "—" },
    { key: "gstNumber", header: "GST", render: (row) => row.gstNumber || "—" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "createdAt",
      header: "Added",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setViewing(row);
            }}
            title="View full details"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(editHref(row._id));
            }}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
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
      {!embedded && (
        <PageHeader title="All Clients" subtitle={`${crud.total} clients on record`}>
          <Link to={addPath}>
            <Button>
              <Plus size={15} />
              Add Client
            </Button>
          </Link>
        </PageHeader>
      )}

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name, company, email or phone"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: ["active", "inactive", "lead"],
            },
          ]}
        >
          {embedded && (
            <Link to={addPath} className="ml-auto">
              <Button size="sm">
                <Plus size={15} />
                Add client
              </Button>
            </Link>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={setViewing}
          emptyTitle="No clients found"
          emptyMessage="Add your first client to start tracking projects against them."
        />
      </Card>

      <ProfileDetail
        open={Boolean(viewing)}
        resource="clients"
        id={viewing?._id}
        roleLabel="Client"
        onClose={() => setViewing(null)}
        onEdit={(id) => navigate(editHref(id))}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete client"
        message={`Delete "${target?.name}"? This cannot be undone.`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
