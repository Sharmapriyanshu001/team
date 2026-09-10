import { useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, Mail, Phone } from "lucide-react";

import { useCrud } from "../hooks/crud";
import { initialsOf } from "../../shared/format";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  ProgressBar,
} from "../../shared/components/ui";

const VIEWS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");
export default function MyProjects() {
  const crud = useCrud("projects");
  const [view, setView] = useState("");

  const changeView = (key) => {
    setView(key);
    crud.setFilter("view", key);
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
      key: "operationsManager",
      header: "Your contact",
      render: (row) =>
        row.operationsManager ? (
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
              {initialsOf(row.operationsManager.name)}
            </span>
            <div className="min-w-0 text-xs">
              <p className="truncate font-medium text-slate-800">{row.operationsManager.name}</p>
              <p className="flex items-center gap-1 truncate text-slate-400">
                <Mail size={10} />
                {row.operationsManager.email}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-slate-400">To be assigned</span>
        ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "progress", header: "Progress", render: (row) => <ProgressBar value={row.progress} /> },
    {
      key: "tasks",
      header: "Work items",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {row.tasksCompleted} of {row.tasks} done
        </span>
      ),
    },
    {
      key: "remaining",
      header: "Remaining",
      render: (row) => {
        const left = Math.max(0, (row.tasks || 0) - (row.tasksCompleted || 0));
        return (
          <span className={left ? "text-slate-700" : "text-green-700"}>
            {left ? `${left} to go` : "All done"}
          </span>
        );
      },
    },
    {
      key: "endDate",
      header: "Target date",
      render: (row) => {
        const overdue =
          row.endDate && new Date(row.endDate) < new Date() && row.status !== "completed";
        return <span className={overdue ? "font-medium text-red-600" : ""}>{fmt(row.endDate)}</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader title="My Projects" subtitle={`${crud.total} projects with us`}>
        <Link to="/client/progress">
          <Button variant="outline">
            <Gauge size={15} />
            Progress board
          </Button>
        </Link>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <div className="mb-3 flex gap-2">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            onClick={() => changeView(item.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              view === item.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

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
          emptyTitle="No projects here"
          emptyMessage="Projects booked under your account will appear here."
        />
      </Card>

      {/* Contact card for the leads, so the client always has a phone number */}
      {crud.rows.some((row) => row.operationsManager?.phone) && (
        <Card className="mt-4 p-5">
          <p className="mb-3 text-sm font-semibold text-slate-900">Who to call</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ...new Map(
                crud.rows
                  .filter((row) => row.operationsManager)
                  .map((row) => [row.operationsManager._id, row.operationsManager])
              ).values(),
            ].map((leader) => (
              <div
                key={leader._id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
                  {initialsOf(leader.name)}
                </span>
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-slate-800">{leader.name}</p>
                  <p className="truncate text-slate-400">{leader.designation || "Project lead"}</p>
                  {leader.phone && (
                    <p className="mt-0.5 flex items-center gap-1 text-slate-500">
                      <Phone size={10} />
                      {leader.phone}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
