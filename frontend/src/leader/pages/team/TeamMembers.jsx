import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Eye,
  Mail,
  MessageSquare,
  Phone,
  TriangleAlert,
  UserMinus,
  UserPlus,
} from "lucide-react";

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
  const navigate = useNavigate();
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
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            {row.tasksOpen} open
          </span>
          <span className="text-slate-500">{row.tasksCompleted} done</span>
          {row.tasksOverdue > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-inset ring-red-200">
              <TriangleAlert size={11} />
              {row.tasksOverdue}
            </span>
          )}
        </div>
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
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/operation-manager/team/member?id=${row._id}`);
            }}
          >
            <Eye size={14} />
            Details
          </Button>
          <Link to="/operation-manager/chat/employees" onClick={(e) => e.stopPropagation()}>
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
      {/**
       * "People on your team", not "people who report to you" — the list now
       * includes everybody on a project this manager runs, who are their team
       * in every sense that matters here even without a reporting line.
       */}
      <PageHeader
        title="Team Members"
        subtitle={
          crud.total
            ? `${crud.total} ${crud.total === 1 ? "person" : "people"} on your team — open one for their full record`
            : "Nobody on your team yet"
        }
      >
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
          // The row is the way in: what they are carrying, what they have
          // finished and which of your projects it is spread across
          onRowClick={(row) => navigate(`/operation-manager/team/member?id=${row._id}`)}
          emptyTitle="No team members yet"
          emptyMessage="Anybody on a project you run appears here. Press Add Members to bring in someone else."
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
