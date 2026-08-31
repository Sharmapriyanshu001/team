import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Pencil,
  Star,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

import adminApi from "../adminApi";
import Modal from "../../shared/components/Modal";
import { Alert, Badge, Button, Loader, ProgressBar } from "../../shared/components/ui";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const formatMoney = (value) => {
  if (!value) return "—";
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Number(value).toLocaleString("en-IN")}`;
};

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="break-words text-sm text-slate-800">{value || "—"}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    review: "border-blue-300 bg-blue-50",
    danger: "border-red-200 bg-red-50",
  };
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-center ${
        tones[tone] || "border-slate-200 bg-slate-50/60"
      }`}
    >
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function Section({ title, count, action, children }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 font-normal text-slate-400">({count})</span>
          )}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyLine({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">
      {children}
    </p>
  );
}

function TaskRow({ task }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
        <p className="truncate text-xs text-slate-400">
          {task.assignedTo?.name || "Unassigned"} · due {formatDate(task.dueDate)}
        </p>
      </div>
      {task.reviewRating > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-slate-400">
          <Star size={12} className="fill-blue-600 text-blue-600" />
          {task.reviewRating}
        </span>
      )}
      <Badge value={task.status} />
    </div>
  );
}

/**
 * Full project view for the admin, opened from the All Projects list. Answers
 * the two questions that screen cannot: who is on it, and what work is sitting
 * there waiting to be signed off.
 */
export default function ProjectDetail({ open, id, onClose, onEdit, onReview }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !id) return undefined;

    let active = true;
    setLoading(true);
    setError("");
    setData(null);

    adminApi
      .get(`/admin/projects/${id}/details`)
      .then((res) => active && setData(res.data))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load this project")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [open, id]);

  const project = data?.project;
  const stats = data?.stats;

  const inReview = (data?.tasks || []).filter((task) => task.status === "review");
  const openTasks = (data?.tasks || []).filter((task) =>
    ["pending", "in_progress"].includes(task.status)
  );

  return (
    <Modal
      open={open}
      size="lg"
      title={project?.name || "Project details"}
      subtitle={
        project
          ? `${project.code || "no code"} · ${project.client?.company || project.client?.name || "No client"}`
          : "Loading project"
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onEdit?.(id)}>
            <Pencil size={15} />
            Edit
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>

      {loading && <Loader label="Loading project..." />}

      {project && (
        <div>
          {/* status strip */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 p-4">
            <Badge value={project.status} />
            <Badge value={project.priority} />
            <span className="flex items-center gap-2 text-xs text-slate-500">
              Progress
              <span className="w-28">
                <ProgressBar value={project.progress} />
              </span>
            </span>
          </div>

          {/* work waiting for a decision */}
          <Section title="At a glance">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Waiting for review"
                value={stats.inReview}
                tone={stats.inReview ? "review" : undefined}
              />
              <Stat label="Open tasks" value={stats.pending + stats.inProgress} />
              <Stat
                label="Overdue"
                value={stats.overdue}
                tone={stats.overdue ? "danger" : undefined}
              />
              <Stat label="Completed" value={stats.completed} />
            </div>
          </Section>

          {/* ownership */}
          <Section title="Ownership">
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              <Row
                icon={UserCog}
                label="Team leader"
                value={
                  project.teamLeader
                    ? `${project.teamLeader.name}${
                        project.teamLeader.designation ? ` · ${project.teamLeader.designation}` : ""
                      }`
                    : "Not assigned"
                }
              />
              <Row icon={Users} label="Team size" value={`${stats.members} members`} />
              <Row icon={Wallet} label="Budget" value={formatMoney(project.budget)} />
              <Row
                icon={CalendarDays}
                label="Timeline"
                value={`${formatDate(project.startDate)} → ${formatDate(project.endDate)}`}
              />
            </div>
          </Section>

          {/* review queue — the point of this screen */}
          <Section
            title="Waiting for your review"
            count={inReview.length}
            action={
              inReview.length > 0 && (
                <Button size="sm" variant="outline" onClick={onReview}>
                  <ClipboardCheck size={13} />
                  Open reviews
                </Button>
              )
            }
          >
            {inReview.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-blue-200 bg-blue-50/30">
                {inReview.map((task) => (
                  <TaskRow key={task._id} task={task} />
                ))}
              </div>
            ) : (
              <EmptyLine>Nothing submitted for sign-off right now.</EmptyLine>
            )}
          </Section>

          {/* the team */}
          <Section title="Team on this project" count={project.members?.length || 0}>
            {project.members?.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {project.members.map((member) => (
                  <div key={member._id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {member.designation || "Employee"} · {member.email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine>No members yet — add them from Assign Team.</EmptyLine>
            )}
          </Section>

          {/* daily work coming in */}
          <Section title="Work logged this week" count={`${stats.hoursThisWeek} h`}>
            {data.logs.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.logs.map((log) => (
                  <div key={log._id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {log.employee?.name || "Someone"}
                      </p>
                      <p className="shrink-0 text-[11px] text-slate-400">
                        {formatDate(log.date)} · {log.hours}h
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{log.summary}</p>
                    {log.blockers && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-700">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        {log.blockers}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine>Nobody has logged work against this project this week.</EmptyLine>
            )}
          </Section>

          {/* open tasks */}
          <Section title="Open tasks" count={openTasks.length}>
            {openTasks.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {openTasks.map((task) => (
                  <TaskRow key={task._id} task={task} />
                ))}
              </div>
            ) : (
              <EmptyLine>No open tasks on this project.</EmptyLine>
            )}
          </Section>

          {/* issues */}
          {data.issues.length > 0 && (
            <Section title="Issues" count={stats.openIssues}>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.issues.map((issue) => (
                  <div key={issue._id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{issue.title}</p>
                      <p className="truncate text-xs text-slate-400">
                        {issue.assignedTo?.name || "Unassigned"} · raised by{" "}
                        {issue.raisedBy?.name || "—"}
                      </p>
                    </div>
                    <Badge value={issue.severity} />
                    <Badge value={issue.status} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* documents */}
          {data.files.length > 0 && (
            <Section title="Documents" count={data.files.length}>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.files.map((file) => (
                  <div key={file._id} className="flex items-center gap-3 px-4 py-2.5">
                    <FileText size={15} className="shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{file.title}</p>
                      <p className="truncate text-xs text-slate-400">{formatDate(file.createdAt)}</p>
                    </div>
                    <Badge value={file.category} />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </Modal>
  );
}
