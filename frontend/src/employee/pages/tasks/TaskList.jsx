import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Play, Send } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import { useEmployee } from "../../employeeContext";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { Alert, Badge, Button, Card, PageHeader } from "../../../shared/components/ui";

// Due dates are stored at midnight, so compare against the start of today.
const isOverdue = (task) => {
  if (!task.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

/** Shared by Today's Tasks / Pending / Completed. */
export default function TaskList({ title, subtitle, baseFilters = {}, readOnly = false }) {
  const navigate = useNavigate();
  const crud = useCrud("tasks", { initialFilters: baseFilters });
  const lookups = useLookups();
  const { markTasksSeen } = useEmployee();
  const [busyId, setBusyId] = useState("");

  // Opening any task list is the employee looking, so the sidebar dot goes out
  useEffect(() => {
    markTasksSeen?.();
  }, [markTasksSeen]);

  // The only transitions an employee owns; completing is the leader's call.
  const move = async (task, status) => {
    setBusyId(task._id);
    try {
      await crud.update(task._id, { status });
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not update the task");
    } finally {
      setBusyId("");
    }
  };

  const columns = [
    {
      key: "title",
      header: "Task",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">{row.project?.name || "No project"}</p>
        </div>
      ),
    },
    { key: "priority", header: "Priority", render: (row) => <Badge value={row.priority} /> },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => (
        <span className={isOverdue(row) ? "font-medium text-red-600" : ""}>
          {row.dueDate ? new Date(row.dueDate).toLocaleDateString("en-IN") : "—"}
        </span>
      ),
    },
    {
      key: "assignedBy",
      header: "Assigned by",
      render: (row) => row.assignedBy?.name || "Admin",
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          {!readOnly && row.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === row._id}
              onClick={() => move(row, "in_progress")}
            >
              <Play size={13} />
              Start
            </Button>
          )}
          {!readOnly && row.status === "in_progress" && (
            <Button size="sm" loading={busyId === row._id} onClick={() => move(row, "review")}>
              <Send size={13} />
              Submit
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/employee/tasks/details?id=${row._id}`)}
          >
            <Eye size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle || `${crud.total} tasks`} />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search your tasks"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
            },
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
          emptyTitle="Nothing here"
          emptyMessage="Tasks matching this view will show up here."
        />
      </Card>
    </div>
  );
}
