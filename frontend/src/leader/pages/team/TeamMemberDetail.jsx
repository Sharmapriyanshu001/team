import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  Star,
  TriangleAlert,
} from "lucide-react";

import leaderApi from "../../leaderApi";
import { initialsOf, prettify } from "../../../shared/format";
import DataTable from "../../../shared/components/DataTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
} from "../../../shared/components/ui";

/**
 * One person on the manager's team, in full.
 *
 * The list answers "who is on my team"; this answers the question a manager
 * actually opens a name to ask — what are they carrying, what have they
 * finished, where is it spread, and is any of it stuck.
 *
 * Deliberately not a staff file: no salary, no documents, no bank details.
 * Those belong to HR and the administrators, and a manager needing to know how
 * somebody is doing is not the same as needing their paperwork.
 */

const TONES = {
  red: { icon: "bg-red-50 text-red-600", value: "text-red-600", dot: "bg-red-500" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-600", dot: "bg-amber-500" },
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-blue-600", dot: "bg-blue-500" },
  green: { icon: "bg-green-50 text-green-600", value: "text-green-600", dot: "bg-green-500" },
  slate: { icon: "bg-slate-100 text-slate-600", value: "text-slate-900", dot: "bg-slate-400" },
};

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const isOverdue = (task) => {
  if (!task?.dueDate || task.status === "completed") return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < startOfToday;
};

function Stat({ icon: Icon, label, value, sub, tone = "slate" }) {
  const t = TONES[tone];

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className={`mt-3 text-2xl font-bold tracking-tight ${t.value}`}>{value}</p>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </Card>
  );
}

export default function TeamMemberDetail() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id") || "";

  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);

  const [loadingList, setLoadingList] = useState(true);
  // Arriving from a row carries an id already, so this starts on rather than
  // being switched on from inside the effect
  const [loadingDetail, setLoadingDetail] = useState(Boolean(selectedId));
  const [error, setError] = useState("");

  // The picker, so a manager can move between people without going back
  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/team")
      .then(({ data: res }) => {
        if (!active) return;
        setPeople(res.items || []);
        if (!selectedId && res.items?.length) {
          setParams({ id: res.items[0]._id }, { replace: true });
        }
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load your team");
      })
      .finally(() => active && setLoadingList(false));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;

    leaderApi
      .get(`/leader/team/${selectedId}`)
      .then(({ data: res }) => {
        if (!active) return;
        setData(res);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err.response?.data?.message || "Could not open that person");
      })
      .finally(() => active && setLoadingDetail(false));

    return () => {
      active = false;
    };
  }, [selectedId]);

  if (loadingList) return <Loader label="Loading your team..." />;

  if (!people.length) {
    return (
      <div>
        <PageHeader title="Team Member" />
        <Card>
          <EmptyState
            icon={ListChecks}
            title="No team members yet"
            message="People who report to you, or who are on a project you run, show up here."
          />
        </Card>
      </div>
    );
  }

  const member = data?.member;
  const stats = data?.stats;

  const taskColumns = [
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
      key: "progress",
      header: "Progress",
      render: (row) => <ProgressBar value={row.progress ?? 0} />,
    },
    {
      key: "dueDate",
      header: "Due",
      render: (row) => (
        <span className={isOverdue(row) ? "font-medium text-red-600" : ""}>{fmt(row.dueDate)}</span>
      ),
    },
    {
      key: "reviewRating",
      header: "Rated",
      render: (row) =>
        row.reviewRating > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
            <Star size={12} className="fill-blue-600 text-blue-600" />
            {row.reviewRating}/5
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={member?.name || "Team Member"}
        subtitle={
          member
            ? [member.designation, member.department].filter(Boolean).join(" · ") ||
              "No designation recorded"
            : "Pick somebody on your team"
        }
      >
        <Select
          value={selectedId}
          onChange={(e) => {
            setLoadingDetail(true);
            setData(null);
            setParams({ id: e.target.value });
          }}
          options={people.map((p) => ({ value: p._id, label: p.name }))}
          className="w-52"
        />
        <Link
          to="/operation-manager/team"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={15} />
          All members
        </Link>
      </PageHeader>

      <Alert>{error}</Alert>

      {loadingDetail && <Loader label="Opening their record..." />}

      {!loadingDetail && data && (
        <>
          {/* ------------------------------------------------------ who */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                {initialsOf(member.name)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-lg font-semibold text-slate-900">{member.name}</p>
                  <Badge value={member.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail size={12} className="text-slate-400" />
                    {member.email}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Phone size={12} className="text-slate-400" />
                    {member.phone || "—"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={12} className="text-slate-400" />
                    Joined {fmt(member.joiningDate)}
                  </span>
                  {member.reportsTo?.name && (
                    <span className="inline-flex items-center gap-1.5">
                      Reports to {member.reportsTo.name}
                    </span>
                  )}
                </div>
              </div>

              <Link to="/operation-manager/chat/employees" className="shrink-0">
                <Button variant="outline" size="sm">
                  <MessageSquare size={14} />
                  Message
                </Button>
              </Link>
              <Link to="/operation-manager/tasks/create" className="shrink-0">
                <Button size="sm">
                  <ListChecks size={14} />
                  Assign task
                </Button>
              </Link>
            </div>

            {member.responsibilities?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                {member.responsibilities.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* --------------------------------------------- what they carry */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              icon={ListChecks}
              label="Open tasks"
              value={stats.tasksOpen}
              sub={`${stats.tasksNotStarted} not started · ${stats.tasksInProgress} in progress`}
              tone="amber"
            />
            <Stat
              icon={TriangleAlert}
              label="Overdue"
              value={stats.overdue}
              sub={stats.overdue ? "Past the deadline" : "Nothing is late"}
              tone={stats.overdue ? "red" : "green"}
            />
            <Stat
              icon={ClipboardCheck}
              label="Waiting on you"
              value={stats.tasksInReview}
              sub={stats.tasksInReview ? "Submitted for review" : "Nothing to review"}
              tone="blue"
            />
            <Stat
              icon={CheckCircle2}
              label="Completed"
              value={stats.tasksCompleted}
              sub={`${stats.completionRate}% of ${stats.tasksTotal} assigned`}
              tone="green"
            />
          </div>

          {/* ------------------------------------------ quality and effort */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Review rating</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {stats.ratedTasks ? `${stats.avgRating} / 5` : "—"}
                  </p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <Star size={18} />
                </span>
              </div>
              <div className="mt-3 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={15}
                    className={
                      star <= Math.round(stats.avgRating)
                        ? "fill-blue-600 text-blue-600"
                        : "text-slate-300"
                    }
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {stats.ratedTasks
                  ? `Across ${stats.ratedTasks} reviewed tasks`
                  : "Nothing of theirs has been rated yet"}
              </p>
            </Card>

            <Card className="p-5">
              <p className="text-sm font-medium text-slate-600">Completion rate</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.completionRate}%</p>
              <div className="mt-3">
                <ProgressBar value={stats.completionRate} />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {stats.tasksCompleted} of {stats.tasksTotal} tasks ever assigned
              </p>
            </Card>

            <Card className="p-5">
              <p className="text-sm font-medium text-slate-600">This month</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stats.hoursThisMonth} h</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                logged over {stats.daysLogged} {stats.daysLogged === 1 ? "day" : "days"}
              </p>
              <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {stats.attendanceDays
                  ? `${stats.attendanceRate}% attendance this month`
                  : "No attendance recorded this month"}
                {stats.issuesRaised > 0 && (
                  <span className="ml-1 text-red-600">
                    · {stats.issuesRaised} open{" "}
                    {stats.issuesRaised === 1 ? "blocker" : "blockers"} raised
                  </span>
                )}
              </div>
            </Card>
          </div>

          {/* -------------------------------------- where the work sits */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Recent work"
                subtitle="Their last dozen tasks, most recently touched first"
                action={
                  <Link
                    to="/operation-manager/tasks/assigned"
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    All tasks
                  </Link>
                }
              />
              <DataTable
                columns={taskColumns}
                rows={data.recentTasks}
                emptyTitle="Nothing assigned yet"
                emptyMessage="Work you give this person shows up here."
              />
            </Card>

            <Card>
              <CardHeader
                title="Projects"
                subtitle={
                  data.projects.length
                    ? "Your projects they are working on"
                    : "None of your projects yet"
                }
              />
              {data.projects.length ? (
                <div className="divide-y divide-slate-100">
                  {data.projects.map((project) => (
                    <Link
                      key={project._id}
                      to={`/operation-manager/projects/details?id=${project._id}`}
                      className="block px-5 py-3 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {project.name}
                        </p>
                        <Badge value={project.status} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {project.completed} of {project.total} of their tasks done
                        {project.open ? ` · ${project.open} open` : ""}
                        {project.inReview ? ` · ${project.inReview} to review` : ""}
                      </p>
                      <div className="mt-2">
                        <ProgressBar value={project.progress ?? 0} />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={FolderKanban}
                  title="No projects yet"
                  message="Put them on one from Assign Work."
                />
              )}
            </Card>
          </div>

          {/* ------------------------------------------- delivery history */}
          <Card className="mt-4">
            <CardHeader title="Delivery" subtitle="Tasks they completed, last 6 months" />
            <div className="flex items-end gap-2 overflow-x-auto p-5">
              {(() => {
                const peak = Math.max(1, ...data.monthlyTrend.map((m) => m.tasksCompleted));

                return data.monthlyTrend.map((month) => (
                  <div key={month.month} className="flex min-w-[3rem] flex-1 flex-col items-center">
                    <span className="mb-1 text-[11px] font-medium text-slate-600">
                      {month.tasksCompleted}
                    </span>
                    <div
                      className="w-full rounded-t bg-blue-600"
                      style={{
                        height: `${Math.max(4, (month.tasksCompleted / peak) * 96)}px`,
                        opacity: month.tasksCompleted ? 1 : 0.15,
                      }}
                    />
                    <span className="mt-1.5 text-[11px] text-slate-400">{month.month}</span>
                  </div>
                ));
              })()}
            </div>
            <p className="px-5 pb-4 text-[11px] text-slate-400">
              {prettify(member.employmentType || "")}
              {member.employmentType && member.workLocation ? " · " : ""}
              {prettify(member.workLocation || "")}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
