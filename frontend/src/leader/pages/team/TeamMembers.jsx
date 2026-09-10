import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Phone, BarChart3, MessageSquare, UserMinus, UserPlus } from "lucide-react";

import leaderApi from "../../leaderApi";
import { useCrud } from "../../hooks/crud";
import AddMembers from "./AddMembers";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
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

  const [adding, setAdding] = useState(false);
  const [releasing, setReleasing] = useState(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState("");

  /**
   * Letting somebody go back to the unassigned pool.
   *
   * Their tasks and projects are deliberately untouched — this is a change of
   * reporting line, not a reason to strip a month of work off the board.
   */
  const release = async () => {
    setWorking(true);
    try {
      const { data } = await leaderApi.delete(`/leader/team/members/${releasing._id}`);
      setReleasing(null);
      setDone(data.message);
      crud.refresh();
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not remove them");
    } finally {
      setWorking(false);
    }
  };

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
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          <Link to="/operation-manager/chat/employees">
            <Button size="sm" variant="outline">
              <MessageSquare size={14} />
              Chat
            </Button>
          </Link>
          {/* Back to the unassigned pool. Their work is left alone. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReleasing(row);
            }}
            title="Remove from your team"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <UserMinus size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Team Members" subtitle={`${crud.total} people report to you`}>
        <Link to="/operation-manager/team/performance">
          <Button variant="outline">
            <BarChart3 size={15} />
            Performance
          </Button>
        </Link>
        {/* Build your own team rather than waiting to be given one */}
        <Button onClick={() => setAdding(true)}>
          <UserPlus size={15} />
          Add Members
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>
      <Alert tone="success">{done}</Alert>

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
          emptyMessage="Press Add Members to pick from the employees who are not on anybody's team."
        />
      </Card>

      <AddMembers
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(message) => {
          setDone(message);
          crud.refresh();
        }}
      />

      <ConfirmDialog
        open={Boolean(releasing)}
        title="Remove from your team"
        message={`${releasing?.name} will go back to the unassigned list and can be picked up by another leader. Their tasks and projects are not affected.`}
        confirmLabel="Remove"
        loading={working}
        onConfirm={release}
        onClose={() => setReleasing(null)}
      />
    </div>
  );
}
