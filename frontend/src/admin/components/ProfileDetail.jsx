import { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Eye,
  EyeOff,
  FileText,
  IdCard,
  KeyRound,
  Landmark,
  LogIn,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  ShieldAlert,
  StickyNote,
  Users,
  Wallet,
} from "lucide-react";

import adminApi from "../adminApi";
import { CopyRow } from "./LoginCredentials";
import Modal from "../../shared/components/Modal";
import { Alert, Badge, Button, Loader, ProgressBar } from "../../shared/components/ui";
import { passwordNote } from "../../shared/staffPassword";

const initialsOf = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

/**
 * The four identity scans the joining form asks for.
 *
 * Listed by which ones ARRIVED rather than as four rows of yes/no: the useful
 * sentence is "we have the Aadhaar front and back", and four separate lines
 * saying "Not on file" pushes the rest of the record off the screen.
 */
const IDENTITY_SCANS = [
  { key: "aadhaarFront", label: "Aadhaar front" },
  { key: "aadhaarBack", label: "Aadhaar back" },
  { key: "panFront", label: "PAN front" },
  { key: "panBack", label: "PAN back" },
];

function Section({ title, count, children }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
        {count !== undefined && (
          <span className="ml-1.5 font-normal text-slate-400">({count})</span>
        )}
      </p>
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

/** Login ID / password block. Passwords are hashed, so the real one is only
 *  readable while it is still one the system handed out. */
function Credentials({ credentials, portalOff }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <KeyRound size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Login details</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {portalOff ? "Portal access is turned off" : credentials.portal}
            </p>
          </div>
        </div>
        {credentials.password && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-blue-600"
          >
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
            {visible ? "Hide" : "Show"}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CopyRow label="Login ID" value={credentials.loginId} hint="Their email is the login ID" />

        {credentials.password ? (
          <CopyRow
            label="Password"
            value={credentials.password}
            display={visible ? credentials.password : "•".repeat(credentials.password.length)}
            hint={passwordNote(credentials)}
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Password</p>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {credentials.hasPassword ? "Custom password set" : "No password set yet"}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {credentials.hasPassword
                ? "Stored encrypted and cannot be read back. Use Edit to set a new one."
                : "Open Edit and save a password to give them portal access."}
            </p>
          </div>
        )}
      </div>

      {credentials.password && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          Everybody starts on the same password — ask them to change it from their Profile page.
        </p>
      )}
    </div>
  );
}

/**
 * Full profile for one operations manager, employee or client, opened by clicking
 * their row on the list. Loads /admin/<resource>/:id/details on open, then
 * renders the blocks that apply to that kind of record.
 */
export default function ProfileDetail({ open, resource, id, roleLabel, onClose, onEdit }) {
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
      .get(`/admin/${resource}/${id}/details`)
      .then((res) => active && setData(res.data))
      .catch(
        (err) =>
          active && setError(err.response?.data?.message || "Could not load these details")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [open, id, resource]);

  const isClient = resource === "clients";
  const isLeader = resource === "operations-managers";
  const isEmployee = resource === "employees";

  const record = data?.item;
  const stats = data?.stats;

  return (
    <Modal
      open={open}
      size="lg"
      title={record?.name || `${roleLabel} details`}
      subtitle={
        record ? (isClient ? record.company || roleLabel : record.designation || roleLabel) : "Loading profile"
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

      {loading && <Loader label="Loading profile..." />}

      {record && (
        <div>
          {/* identity */}
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {initialsOf(record.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900">{record.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge value={record.status} />
                <span>{(isClient ? record.company : record.designation) || roleLabel}</span>
                {!isClient && record.department && <span>· {record.department}</span>}
              </div>
            </div>
          </div>

          <Credentials
            credentials={data.credentials}
            portalOff={isClient && record.portalAccess === false}
          />

          {/* profile fields */}
          <Section title="Profile">
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              <Row icon={Mail} label="Email" value={record.email} />
              <Row icon={Phone} label="Mobile" value={record.phone} />

              {isClient ? (
                <>
                  <Row icon={Building2} label="Company" value={record.company} />
                  <Row icon={Receipt} label="GST number" value={record.gstNumber} />
                  <Row icon={MapPin} label="Address" value={record.address} />
                  <Row icon={Wallet} label="Total project value" value={formatMoney(stats.budget)} />
                  <Row icon={CalendarDays} label="Added on" value={formatDate(record.createdAt)} />
                  <Row
                    icon={LogIn}
                    label="Last portal login"
                    value={record.lastLogin ? formatDate(record.lastLogin) : "Never signed in"}
                  />
                  {record.notes && (
                    <div className="sm:col-span-2">
                      <Row icon={StickyNote} label="Notes" value={record.notes} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Row icon={Briefcase} label="Designation" value={record.designation} />
                  <Row icon={Building2} label="Department" value={record.department} />
                  <Row icon={CalendarDays} label="Joining date" value={formatDate(record.joiningDate)} />
                  <Row icon={CalendarDays} label="Added on" value={formatDate(record.createdAt)} />
                  {isEmployee && (
                    <Row icon={Users} label="Reports to" value={record.reportsTo?.name} />
                  )}
                </>
              )}
            </div>
          </Section>

          {/**
           * Everything the joining form collected.
           *
           * The five-step form asks for identity numbers, scans, bank details
           * and where they worked before — and none of it appeared anywhere
           * afterwards. Somebody checking whether a new starter's PAN had
           * arrived had to open the edit form and step through it, which is
           * how a read turns into an accidental write.
           *
           * A missing field prints "Not on file" rather than being hidden: the
           * gap is the thing being looked for.
           */}
          {!isClient && (
            <>
              <Section title="Identity">
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  <Row
                    icon={IdCard}
                    label="Aadhaar number"
                    value={record.documents?.aadhaarNumber || "Not on file"}
                  />
                  <Row
                    icon={IdCard}
                    label="PAN number"
                    value={record.documents?.panNumber || "Not on file"}
                  />
                  <div className="sm:col-span-2">
                    <Row
                      icon={FileText}
                      label="Scans"
                      value={
                        IDENTITY_SCANS.filter((f) => record.documents?.[f.key]?.storedName)
                          .map((f) => f.label)
                          .join(", ") || "None uploaded"
                      }
                    />
                  </div>
                </div>
              </Section>

              <Section title="Bank">
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  <Row
                    icon={Wallet}
                    label="Account name"
                    value={record.bank?.accountName || "Not on file"}
                  />
                  <Row
                    icon={Wallet}
                    label="Account number"
                    value={record.bank?.accountNumber || "Not on file"}
                  />
                  <Row icon={Landmark} label="Bank" value={record.bank?.bankName || "Not on file"} />
                  <Row icon={Landmark} label="IFSC" value={record.bank?.ifsc || "Not on file"} />
                </div>
              </Section>

              {(record.previousEmployment?.companyName ||
                record.previousEmployment?.designation ||
                record.previousEmployment?.lastSalary) && (
                <Section title="Previous employment">
                  <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                    <Row
                      icon={Building2}
                      label="Company"
                      value={record.previousEmployment?.companyName}
                    />
                    <Row
                      icon={Briefcase}
                      label="Designation"
                      value={record.previousEmployment?.designation}
                    />
                    <Row
                      icon={CalendarDays}
                      label="From"
                      value={formatDate(record.previousEmployment?.fromDate)}
                    />
                    <Row
                      icon={CalendarDays}
                      label="To"
                      value={formatDate(record.previousEmployment?.toDate)}
                    />
                    <Row
                      icon={Wallet}
                      label="Last salary"
                      value={
                        record.previousEmployment?.lastSalary
                          ? formatMoney(record.previousEmployment.lastSalary)
                          : "—"
                      }
                    />
                    <Row
                      icon={StickyNote}
                      label="Reason for leaving"
                      value={record.previousEmployment?.reasonForLeaving}
                    />
                  </div>
                </Section>
              )}
            </>
          )}

          {/* numbers */}
          <Section title="At a glance">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Projects" value={stats.projects} />

              {isLeader && <Stat label="Team size" value={stats.teamSize} />}
              {isEmployee && <Stat label="Completed tasks" value={stats.tasksCompleted} />}
              {isClient && <Stat label="Active projects" value={stats.projectsActive} />}

              <Stat label="Open tasks" value={stats.tasksPending} />

              {isLeader && <Stat label="Avg progress" value={`${stats.avgProgress}%`} />}
              {isEmployee && (
                <Stat
                  label="Present this month"
                  value={`${stats.presentThisMonth}/${stats.markedThisMonth}`}
                />
              )}
              {isClient && <Stat label="Open issues" value={stats.openIssues} />}
            </div>
          </Section>

          {/* projects */}
          <Section
            title={isLeader ? "Projects owned" : isClient ? "Their projects" : "Projects involved in"}
            count={data.projects.length}
          >
            {data.projects.length ? (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.projects.map((project) => (
                  <div key={project._id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{project.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {project.code || "—"}
                        {isClient
                          ? project.operationsManager?.name
                            ? ` · Lead: ${project.operationsManager.name}`
                            : " · No operations manager"
                          : project.client?.name
                            ? ` · ${project.client.name}`
                            : ""}
                      </p>
                    </div>
                    <div className="hidden w-28 sm:block">
                      <ProgressBar value={project.progress} />
                    </div>
                    <Badge value={project.status} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine>No projects yet.</EmptyLine>
            )}
          </Section>

          {/* team members — operations managers only */}
          {isLeader && (
            <Section title="Team members" count={data.team.length}>
              {data.team.length ? (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {data.team.map((member) => (
                    <div key={member._id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                        {initialsOf(member.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {member.designation || "—"} · {member.email}
                        </p>
                      </div>
                      <Badge value={member.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyLine>Nobody reports to them yet.</EmptyLine>
              )}
            </Section>
          )}

          {/* recent tasks — employees only */}
          {isEmployee && data.tasks.length > 0 && (
            <Section title="Recent tasks" count={stats.tasksTotal}>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.tasks.map((task) => (
                  <div key={task._id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                      <p className="truncate text-xs text-slate-400">
                        {task.project?.name || "No project"} · due {formatDate(task.dueDate)}
                      </p>
                    </div>
                    <Badge value={task.status} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* documents — clients only */}
          {isClient && (
            <Section title="Documents" count={stats.files}>
              {data.files.length ? (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {data.files.map((file) => (
                    <div key={file._id} className="flex items-center gap-3 px-4 py-2.5">
                      <FileText size={15} className="shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{file.title}</p>
                        <p className="truncate text-xs text-slate-400">
                          {file.project?.name || "No project"} · {formatDate(file.createdAt)}
                        </p>
                      </div>
                      <Badge value={file.category} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyLine>No documents uploaded for this client.</EmptyLine>
              )}
            </Section>
          )}
        </div>
      )}
    </Modal>
  );
}
