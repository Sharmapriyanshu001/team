import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Gauge,
  History,
  Link2,
  Pencil,
  Star,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import adminApi from "../adminApi";
import Modal from "../../shared/components/Modal";
import ProjectTeamEditor from "./ProjectTeamEditor";
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

/** "3 days ago", for the one figure that says whether a project is moving. */
const sinceText = (value) => {
  if (!value) return "never";
  const days = Math.floor((Date.now() - new Date(value)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
};

/**
 * The two progress figures, side by side.
 *
 * `recorded` is the number typed into the create form, and it is what the
 * client is shown in their own portal. `actual` is what the task board says.
 * On this database they disagree on nearly every project, which is precisely
 * why both are here rather than one: an admin asking "how far along is this"
 * was being answered by whatever somebody last typed.
 *
 * Nothing is overwritten automatically. The button is there because syncing
 * the client-facing number is a decision, and it belongs to the admin.
 */
function ProgressPanel({ progress, onSync, syncing }) {
  if (!progress) return null;

  const { recorded, actual, completed, total, matches } = progress;
  const unmeasured = actual === null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        matches || unmeasured ? "border-slate-200" : "border-amber-300 bg-amber-50/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
            <Gauge size={12} />
            Recorded progress
          </p>
          <p className="text-2xl font-bold text-slate-900">{recorded}%</p>
          <p className="text-[11px] text-slate-400">what the client is shown</p>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">From the task board</p>
          <p className="text-2xl font-bold text-slate-900">
            {unmeasured ? "—" : `${actual}%`}
          </p>
          <p className="text-[11px] text-slate-400">
            {unmeasured ? "no tasks yet" : `${completed} of ${total} tasks done`}
          </p>
        </div>

        <div className="min-w-40 flex-1">
          <ProgressBar value={unmeasured ? recorded : actual} />
          {!matches && !unmeasured && (
            <p className="mt-2 text-[11px] text-amber-800">
              These disagree. The recorded figure was typed by hand and has not been
              recalculated since.
            </p>
          )}
        </div>
      </div>

      {!matches && !unmeasured && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" loading={syncing} onClick={() => onSync(actual)}>
            Set recorded progress to {actual}%
          </Button>
        </div>
      )}
    </div>
  );
}

/** Per person: what they hold, what they finished, and what is late. */
function ContributionRow({ row }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{row.name}</p>
        <p className="truncate text-xs text-slate-400">
          {row.designation || row.role} · last active {sinceText(row.lastActivity)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-500">
        <span title="Finished">
          <strong className="text-slate-800">{row.completed}</strong>/{row.assigned} done
        </span>
        {row.inReview > 0 && <span className="text-blue-700">{row.inReview} in review</span>}
        {row.overdue > 0 && <span className="text-red-600">{row.overdue} overdue</span>}
        {row.hours > 0 && <span>{row.hours}h</span>}
        {row.role === "Off the project" && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">
            off the team
          </span>
        )}
      </div>
    </div>
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
export default function ProjectDetail({
  open,
  id,
  onClose,
  onEdit,
  onReview,
  onChanged,
  // Opened from the list's assign button, which means somebody came here to
  // staff the project rather than to read about it
  startOnTeam = false,
}) {
  const [data, setData] = useState(null);
  // True from the first render: the fetch below starts immediately, and the
  // alternative is a frame of "no project" before the loader appears
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Assigning happens here rather than on a separate screen
  const [editingTeam, setEditingTeam] = useState(startOnTeam);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setLoading(true);
    setReloadKey((n) => n + 1);
  };

  useEffect(() => {
    if (!open || !id) return undefined;

    let active = true;

    adminApi
      .get(`/admin/projects/${id}/details`)
      .then((res) => {
        if (!active) return;
        setError("");
        setData(res.data);
      })
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load this project")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [open, id, reloadKey]);

  /**
   * Saving the team, and saving the progress figure, are the same request —
   * both are a project update, and both want the drawer to show what the
   * server actually stored rather than what the form guessed.
   */
  const save = async (payload, { onError, onDone } = {}) => {
    try {
      await adminApi.put(`/admin/projects/${id}`, payload);
      reload();
      // The list behind the drawer is now stale in exactly the columns it shows
      onChanged?.();
      setDone(onDone || "Saved");
      setTimeout(() => setDone(""), 3000);
      return true;
    } catch (err) {
      const message = err.response?.data?.message || "Could not save that";
      if (onError) onError(message);
      else setError(message);
      return false;
    }
  };

  const saveTeam = async ({ operationsManager, members }) => {
    setSavingTeam(true);
    setTeamError("");
    const ok = await save(
      { operationsManager, members },
      { onError: setTeamError, onDone: "Team updated — everybody added has been told" }
    );
    setSavingTeam(false);
    if (ok) setEditingTeam(false);
  };

  const syncProgress = async (actual) => {
    setSyncing(true);
    await save({ progress: actual }, { onDone: `Recorded progress set to ${actual}%` });
    setSyncing(false);
  };

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
      <Alert tone="success">{done}</Alert>

      {loading && <Loader label="Loading project..." />}

      {project && (
        <div>
          {/* status strip */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Badge value={project.status} />
            <Badge value={project.priority} />
            <span className="text-xs text-slate-500">
              Last activity {sinceText(stats.lastActivity)}
            </span>
            {stats.unassigned > 0 && (
              <span className="text-xs text-amber-700">
                {stats.unassigned} task{stats.unassigned === 1 ? "" : "s"} with nobody on them
              </span>
            )}
          </div>

          {/* how far along it actually is */}
          <ProgressPanel progress={data.progress} onSync={syncProgress} syncing={syncing} />

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
              <Stat label="Open issues" value={stats.openIssues} />
              <Stat label="Hours this week" value={stats.hoursThisWeek} />
              <Stat label="Hours this month" value={stats.hoursThisMonth} />
            </div>
          </Section>

          {/* ownership */}
          <Section title="Ownership">
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              <Row
                icon={UserCog}
                label="Operations Manager"
                value={
                  project.operationsManager
                    ? `${project.operationsManager.name}${
                        project.operationsManager.designation ? ` · ${project.operationsManager.designation}` : ""
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

            {/**
             * Where this job sits in the client's history.
             *
             * Shown only when there is a history — most projects stand alone,
             * and an empty "continues from: —" row on every one of them would
             * be noise on the screen people open most.
             */}
            {/**
             * The answer given when this project was created.
             *
             * Shown whenever somebody was asked, including when they said no —
             * "we checked, and this is new" is worth as much three months later
             * as the link is, and is the difference between an answered
             * question and one nobody put. Projects from before the question
             * existed hold null and show nothing.
             */}
            {project.existingWork?.builtBefore !== null &&
              project.existingWork?.builtBefore !== undefined && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <Link2 size={12} />
                    Built before?
                  </p>

                  {project.existingWork.builtBefore ? (
                    <>
                      <a
                        href={project.existingWork.link}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sm text-blue-700 hover:underline"
                      >
                        {project.existingWork.link}
                      </a>
                      {project.existingWork.note && (
                        <p className="mt-1 text-xs text-slate-500">
                          {project.existingWork.note}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">
                      No — this was new work when it was created.
                    </p>
                  )}
                </div>
              )}

            {(project.previousProject || data.followedBy?.length > 0) && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <History size={12} />
                  Project history
                </p>

                {project.previousProject && (
                  <div className="mb-2">
                    <p className="text-[11px] text-slate-400">Continues from</p>
                    <p className="text-sm text-slate-800">
                      {project.previousProject.code ? `${project.previousProject.code} · ` : ""}
                      {project.previousProject.name}
                      <span className="ml-2 text-xs text-slate-400">
                        {project.previousProject.status?.replace(/_/g, " ")}
                        {project.previousProject.endDate
                          ? ` · delivered ${formatDate(project.previousProject.endDate)}`
                          : ""}
                      </span>
                    </p>
                  </div>
                )}

                {data.followedBy?.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-400">Followed by</p>
                    <ul className="space-y-0.5">
                      {data.followedBy.map((next) => (
                        <li key={next._id} className="text-sm text-slate-800">
                          {next.code ? `${next.code} · ` : ""}
                          {next.name}
                          <span className="ml-2 text-xs text-slate-400">
                            {next.status?.replace(/_/g, " ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
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

          {/* the team — assigned from here rather than from a separate screen */}
          <Section
            title="Team on this project"
            count={project.members?.length || 0}
            action={
              !editingTeam && (
                <Button size="sm" variant="outline" onClick={() => setEditingTeam(true)}>
                  <UserPlus size={13} />
                  {project.members?.length ? "Add or remove" : "Assign people"}
                </Button>
              )
            }
          >
            {editingTeam ? (
              <ProjectTeamEditor
                key={project._id}
                project={project}
                onSave={saveTeam}
                onCancel={() => {
                  setEditingTeam(false);
                  setTeamError("");
                }}
                saving={savingTeam}
                error={teamError}
              />
            ) : project.members?.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {project.members.map((member) => {
                  /**
                   * Who put them here. The leader's assign flow has always
                   * written this down; the admin's now does too, so a member
                   * added before either did shows nothing rather than a wrong
                   * name.
                   */
                  const record = (project.memberAssignments || []).find(
                    (row) => String(row.user?._id || row.user) === String(member._id)
                  );

                  return (
                    <div key={member._id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {member.designation || "Employee"} · {member.email}
                        </p>
                      </div>
                      {record?.assignedByName && (
                        <span className="shrink-0 text-[11px] text-slate-400">
                          added by {record.assignedByName} · {formatDate(record.assignedAt)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyLine>
                Nobody is on this project yet — use Assign people above.
              </EmptyLine>
            )}
          </Section>

          {/* what each of them has actually done */}
          {data.contributions?.length > 0 && (
            <Section title="Who has done what" count={data.contributions.length}>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.contributions.map((row) => (
                  <ContributionRow key={row._id} row={row} />
                ))}
              </div>
            </Section>
          )}

          {/* daily work coming in */}
          <Section title="Work logged this month" count={`${stats.hoursThisMonth} h`}>
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
              <EmptyLine>Nobody has logged work against this project in the last month.</EmptyLine>
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
