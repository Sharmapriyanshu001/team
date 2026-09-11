import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Hourglass,
  IdCard,
  Image as ImageIcon,
  KeyRound,
  Landmark,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

import Modal from "../components/Modal";
import SalaryTab from "./SalaryTab";
import { Badge, Loader } from "../components/ui";
import { fileSize, initialsOf, prettify } from "../format";

/**
 * One person's whole record, on one screen.
 *
 * The old version was a stack of sections you scrolled through, and it left
 * most of the joining form out entirely — somebody checking whether a new
 * starter's bank details had arrived had to open the edit form and step
 * through it, which turns a read into an accidental write.
 *
 * This is the same data laid out the way somebody actually reads a person:
 * who they are at the top with a way to reach them, the numbers that say how
 * they are doing, then tabs for the paperwork nobody needs until they need it.
 *
 * WHAT IT WILL NOT INVENT
 *
 * The admin panel and the HR panel return different things — admin sends
 * projects and tasks, HR sends leave and attendance, and only admin sends the
 * login credentials. A tab whose data is absent is not rendered at all rather
 * than shown empty, so this component is honest in both panels without either
 * of them having to describe itself.
 */

/* ------------------------------------------------------------- helpers */

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * A number WhatsApp will accept.
 *
 * Stored numbers are ten digits with no country code, which wa.me refuses —
 * it wants the full international form and silently shows "phone number
 * shared via url is invalid" otherwise. Ten digits get India's 91; anything
 * already longer is assumed to carry its own code and is left alone.
 */
const waNumber = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `91${digits}` : digits;
};

const TILE_TONES = {
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
};

function Tile({ label, value, hint, tone = "blue" }) {
  return (
    <div className={`rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${TILE_TONES[tone]}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
      {hint && <p className="text-[10px] opacity-60">{hint}</p>}
    </div>
  );
}

/**
 * How much work this person carries, and how it is going.
 *
 * The row above answers what is on their plate right now. This one answers
 * the questions somebody actually opens a record to settle — before a review,
 * before handing them another project, before a conversation about their
 * month:
 *
 *   how many projects are they on, and how many did they see through
 *   is anything late
 *   when they are given a date, do they meet it
 *   how much leave have they used, and how long have they been here
 *
 * Every figure is counted by the server across all of their work, not from
 * the twenty task cards the drawer happens to have fetched — see
 * utils/staffRollup.js. Both panels send the same numbers.
 *
 * On-time is blank rather than 100% when nothing has been judged: a person
 * whose tasks never carried a due date has not earned a perfect record, and
 * a tile claiming one would be the most misleading thing on the screen.
 */
function WorkRecord({ person, stats }) {
  const onTime = stats.onTimeRate;

  const cards = [
    {
      icon: FolderKanban,
      label: "Projects assigned",
      value: stats.projects ?? 0,
      hint: (stats.projectsActive ?? 0) > 0 ? `${stats.projectsActive} running now` : "",
    },
    {
      icon: CheckCircle2,
      label: "Projects completed",
      value: stats.projectsCompleted ?? 0,
      tone: "green",
      hint: stats.projects ? `of ${stats.projects} they were put on` : "",
    },
    {
      icon: AlertTriangle,
      label: "Tasks overdue",
      value: stats.tasksOverdue ?? 0,
      tone: (stats.tasksOverdue ?? 0) > 0 ? "amber" : "blue",
      hint: (stats.tasksOverdue ?? 0) > 0 ? "past their due date" : "nothing late",
    },
    {
      icon: Target,
      label: "Finished on time",
      value: onTime === null || onTime === undefined ? "—" : `${onTime}%`,
      tone: onTime === null || onTime === undefined ? "blue" : onTime >= 80 ? "green" : "amber",
      hint:
        onTime === null || onTime === undefined
          ? "no dated work yet"
          : `${stats.tasksOnTime ?? 0} on time · ${stats.tasksLate ?? 0} late`,
    },
    {
      icon: CalendarOff,
      label: "Leave this year",
      value: stats.leaveTakenThisYear === undefined ? "—" : `${stats.leaveTakenThisYear} days`,
      tone: "violet",
      hint: "approved and taken",
    },
    {
      icon: Hourglass,
      label: "With the company",
      value: tenure(person.joiningDate),
      hint: person.joiningDate ? `since ${fmtDate(person.joiningDate)}` : "joining date not set",
    },
  ];

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-900">Work record</p>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>
    </div>
  );
}

/**
 * How long they have been here, in the unit a person would say it in.
 *
 * "0.8 years" is not how anybody answers this question, and neither is "294
 * days" — under a month it is days, under two years it is months, and after
 * that years and the odd months.
 */
function tenure(joiningDate) {
  if (!joiningDate) return "—";

  const start = new Date(joiningDate);
  if (Number.isNaN(start.getTime())) return "—";

  const days = Math.floor((Date.now() - start.getTime()) / 86400000);
  if (days < 0) return "not started";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;

  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years} years`;
}
function StatCard({ icon: Icon, label, value, tone = "blue" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-500">{label}</p>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${TILE_TONES[tone]}`}
        >
          <Icon size={14} />
        </span>
      </div>
      <p className="mt-1.5 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/** A green dot and a word — "is this allowed, yes or no", at a glance. */
function Permission({ label, state, ok = true }) {
  return (
    <div
      className={`rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${
        ok ? "bg-emerald-50/70 ring-emerald-100" : "bg-slate-50 ring-slate-200"
      }`}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`}
        />
        {label}
      </p>
      <p className={`mt-0.5 text-xs ${ok ? "text-emerald-700" : "text-slate-500"}`}>{state}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

/**
 * One stored scan, with a way to actually open it.
 *
 * The Documents tab used to name the files on file and stop there — a line
 * reading "Aadhaar front, PAN front" said the scan existed but not what was on
 * it, so anybody checking a card against the record had to open the edit form
 * to see the picture, which turns a read into an accidental write.
 *
 * Nothing under uploads/ is reachable without a token, so the file is fetched
 * through the panel's own client and handed to the browser as an object URL —
 * a plain <a href> would open a 401. This is the same reason DocumentUpload
 * does it this way on the form side.
 */
function ScanRow({ label, field, file, api, docPath, recordId }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  /**
   * A panel that passed no docPath has no route that serves this file. The
   * row still names the document — knowing it is on file is worth something —
   * but it does not offer a button that could only 404.
   */
  const openable = Boolean(api && docPath && recordId);

  const load = async () => {
    const { data } = await api.get(docPath(recordId, field), { responseType: "blob" });
    return URL.createObjectURL(data);
  };

  const view = async () => {
    setBusy("view");
    setError("");
    try {
      const url = await load();
      window.open(url, "_blank", "noopener");
      // Long enough for the new tab to have loaded it; that tab holds its own
      // reference, so revoking here does not close what is already open.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Could not open that document");
    } finally {
      setBusy("");
    }
  };

  const download = async () => {
    setBusy("download");
    setError("");
    try {
      const url = await load();
      const link = document.createElement("a");
      link.href = url;
      link.download = file.originalName || field;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("Could not download that document");
    } finally {
      setBusy("");
    }
  };

  const isImage =
    String(file.mimeType || "").startsWith("image/") ||
    /\.(jpe?g|png|webp|heic)$/i.test(file.originalName || "");
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-400 ring-1 ring-slate-200">
        <Icon size={15} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-800">{label}</p>
        <p className="truncate text-[11px] text-slate-400">
          {[file.originalName, fileSize(file.size)].filter(Boolean).join(" · ") || "On file"}
        </p>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>

      {openable && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={view}
            disabled={Boolean(busy)}
            title="Open in a new tab"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50"
          >
            <Eye size={14} />
          </button>
          <button
            type="button"
            onClick={download}
            disabled={Boolean(busy)}
            title="Download"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50"
          >
            <Download size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The scans filed against one part of a record — the identity papers, or the
 * three letters a previous employer hands over.
 *
 * Absent documents are left out rather than listed as missing: the count above
 * already says how much of the paperwork has arrived, and a list of five
 * "not uploaded" rows buries the two that are.
 */
function ScanList({ label, items, api, docPath, recordId, empty = "None uploaded" }) {
  const present = items.filter(([, , file]) => file?.storedName);

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        <FileText size={12} />
        {label}
      </p>

      {present.length ? (
        <div className="mt-1.5 space-y-1.5">
          {present.map(([field, itemLabel, file]) => (
            <ScanRow
              key={field}
              field={field}
              label={itemLabel}
              file={file}
              api={api}
              docPath={docPath}
              recordId={recordId}
            />
          ))}
        </div>
      ) : (
        <p className="mt-0.5 text-sm text-slate-800">{empty}</p>
      )}
    </div>
  );
}

/** The stored values are snake_case; these are what a person reads. */
const WORK_LOCATION_LABELS = {
  office: "Office",
  field: "Field",
  hybrid: "Hybrid",
  remote: "Remote",
};

const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
};

/**
 * A list of short labels, as chips.
 *
 * Run together into one comma-separated line they read as prose and nobody
 * scans them; as chips the eye picks out "Google Ads" without reading the
 * other nine. Drawn only when there is something to draw — an empty heading is
 * worse than no heading.
 */
function Chips({ icon: Icon, label, items = [], tone = "blue" }) {
  if (!items.length) return null;

  const tones = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };

  return (
    <div className="sm:col-span-2">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function Grid({ children }) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
      {children}
    </div>
  );
}

const PRIORITY_TONE = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
};

const TASK_TONE = {
  completed: { pill: "green", bar: "bg-emerald-500" },
  review: { pill: "violet", bar: "bg-violet-500" },
  in_progress: { pill: "blue", bar: "bg-blue-500" },
  pending: { pill: "slate", bar: "bg-slate-300" },
};

/** Late, and not finished. Due today is not late — the day is not over. */
const isLate = (task) => {
  if (task.status === "completed" || !task.dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < today;
};

/**
 * One task, as a card rather than a row.
 *
 * A row could only carry a title and a status pill, which answers "is it done"
 * and nothing else. What somebody opening a person's record actually wants is
 * the shape of the work: how far along it is, whether it is late, what it is
 * worth. All of that is on the task already — it simply had nowhere to appear.
 *
 * The left edge is the priority, as a colour rather than another pill. Three
 * pills on one card is a card nobody reads.
 */
function TaskCard({ task }) {
  const late = isLate(task);
  const tone = TASK_TONE[task.status] || TASK_TONE.pending;
  const progress = task.status === "completed" ? 100 : task.progress || 0;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white px-4 py-3 transition-colors ${
        late ? "border-red-200 bg-red-50/30" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${PRIORITY_TONE[task.priority] || PRIORITY_TONE.low}`}
        title={`${prettify(task.priority || "low")} priority`}
      />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {task.project?.name || "No project"}
          </p>
        </div>
        <Badge value={prettify(task.status)} tone={tone.pill} />
      </div>

      {/* How far along, which a status pill cannot say */}
      {task.status !== "completed" && (
        <div className="mt-2 pl-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${tone.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-[11px]">
        {task.status !== "completed" && (
          <span className="font-medium text-slate-600">{progress}%</span>
        )}

        {task.status === "completed" ? (
          <span className="flex items-center gap-1 text-emerald-700">
            <CheckCircle2 size={11} /> Done {fmtDate(task.completedAt)}
          </span>
        ) : task.dueDate ? (
          <span className={`flex items-center gap-1 ${late ? "font-medium text-red-600" : "text-slate-500"}`}>
            <Clock size={11} />
            {late ? "Overdue — was due " : "Due "}
            {fmtDate(task.dueDate)}
          </span>
        ) : (
          <span className="text-slate-400">No due date</span>
        )}

        {/**
         * Money on the task, and whether it has been earned. The two are
         * different facts: an amount promised is not an amount paid, and the
         * card says which one it is looking at.
         */}
        {task.bonus > 0 && (
          <span
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${
              task.bonusAwardedAt
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
            title={task.bonusAwardedAt ? "Earned" : "Earned when the work is approved"}
          >
            ₹{Number(task.bonus).toLocaleString("en-IN")}
            {task.bonusAwardedAt ? " earned" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One project, with how far it has got.
 *
 * The progress bar is the project's own figure, which is rolled up from its
 * tasks — see backend/utils/projectProgress.js — so it agrees with the task
 * cards below rather than being a second opinion.
 */
function ProjectCard({ project }) {
  const late =
    project.endDate &&
    project.status !== "completed" &&
    new Date(project.endDate) < new Date();

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{project.name}</p>
          <p className="truncate text-xs text-slate-500">
            {project.client?.name || "No client"}
            {project.code ? ` · ${project.code}` : ""}
          </p>
        </div>
        <Badge value={prettify(project.status)} tone={project.status === "completed" ? "green" : "blue"} />
      </div>

      <div className="mt-2.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, project.progress || 0))}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="font-medium text-slate-600">{project.progress || 0}% done</span>
          {project.endDate && (
            <span className={late ? "font-medium text-red-600" : "text-slate-400"}>
              {late ? "Overdue — " : "Target "}
              {fmtDate(project.endDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
      {children}
    </p>
  );
}

/* --------------------------------------------------------- credentials */

function Credentials({ credentials }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <KeyRound size={15} />
          </span>
          Login details
        </p>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
        >
          {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Login ID</p>
          <p className="font-mono text-sm text-slate-900">{credentials.loginId}</p>
          <p className="text-[11px] text-slate-400">Their email is the login ID</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Password</p>
          <p className="font-mono text-sm text-slate-900">
            {visible ? credentials.password || "Not the default any more" : "••••••••••"}
          </p>
          <p className="text-[11px] text-slate-400">
            {credentials.isDefault
              ? "Still the default — their mobile number"
              : "They have set their own"}
          </p>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] text-slate-500">
        They sign in at <span className="font-mono">/</span> — the same address everybody uses.
      </p>
    </div>
  );
}

/* =============================================================== screen */

/**
 * @param data       the whole /details response, whatever the panel returned
 * @param chatPath   optional in-app chat link; the "Chat" button is left out
 *                   without one, because HR has no chat to send anybody to
 * @param api        the panel's axios instance — only the Salary tab needs it,
 *                   because it loads and writes on its own
 * @param basePath   "/admin" or "/hr"
 */
export default function StaffDetail({
  open,
  onClose,
  data,
  loading,
  chatPath,
  api,
  basePath,
  /**
   * Where this panel serves a stored scan from, as (recordId, field) => path.
   *
   * The two panels do not agree on it — admin files documents under the
   * staff type (/admin/employees/:id/documents/:field) and HR under one
   * shared route (/hr/documents/:id/:field) — so the caller names it rather
   * than this component guessing from basePath. A caller that passes none
   * still gets the documents listed, just without the buttons to open them.
   */
  docPath,
  canEditSalary = true,
}) {
  const [tab, setTab] = useState("overview");
  /** Which slice of the task list the Projects & Tasks tab is showing. */
  const [taskFilter, setTaskFilter] = useState("all");

  const person = data?.item;
  const stats = data?.stats || {};

  const wa = waNumber(person?.phone);

  const visibleTasks = useMemo(() => {
    const tasks = data?.tasks || [];
    if (taskFilter === "completed") return tasks.filter((t) => t.status === "completed");
    if (taskFilter === "open") return tasks.filter((t) => t.status !== "completed");
    return tasks;
  }, [data, taskFilter]);

  const documentsOnFile = useMemo(() => {
    const d = person?.documents || {};
    return ["aadhaarFront", "aadhaarBack", "panFront", "panBack"].filter(
      (key) => d[key]?.storedName
    ).length;
  }, [person]);

  /**
   * Only the tabs this panel actually sent data for. See the note at the top:
   * an empty tab is a worse answer than no tab.
   */
  const tabs = useMemo(() => {
    if (!person) return [];

    const list = [
      { key: "overview", label: "Overview" },
      { key: "profile", label: "Profile" },
      { key: "documents", label: "Documents" },
      { key: "bank", label: "Bank" },
    ];

    /**
     * Wages, but only where the panel handed us an api to load them with.
     * The tab is not rendered at all otherwise — a Salary heading over an
     * error is worse than no heading.
     */
    if (api && basePath) list.push({ key: "salary", label: "Salary" });

    if (person.previousEmployment?.companyName) {
      list.push({ key: "history", label: "Employment History" });
    }
    if (data?.projects || data?.tasks) list.push({ key: "work", label: "Projects & Tasks" });
    if (data?.leaves || data?.attendance) list.push({ key: "leave", label: "Leave & Attendance" });
    if (data?.credentials) list.push({ key: "login", label: "Login" });

    return list;
  }, [person, data, api, basePath]);

  const active = tabs.some((t) => t.key === tab) ? tab : "overview";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Employee Details"
      subtitle={person ? `${person.designation || prettify(person.role)}` : undefined}
    >
      {loading || !person ? (
        <Loader label="Loading their record…" />
      ) : (
        <div className="space-y-4">
          {/* ----------------------------------------------------- who */}
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-semibold text-white">
              {initialsOf(person.name)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold text-slate-900">{person.name}</h3>
                <Badge tone="blue">{prettify(person.role)}</Badge>
                <Badge tone={person.status === "active" ? "green" : "slate"}>
                  {prettify(person.status || "active")}
                </Badge>
              </div>

              {/* ------------------------------------ how to reach them */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">
                  <Phone size={13} className="mr-1 inline text-slate-400" />
                  {person.phone || "No mobile on file"}
                </span>

                {person.phone && (
                  <>
                    {/**
                     * Real links, not buttons that call a handler — a phone
                     * number should behave like a phone number, so it opens
                     * the dialler on a phone and Skype or nothing on a desktop
                     * rather than doing something this app invented.
                     */}
                    <a
                      href={`tel:${person.phone}`}
                      title={`Call ${person.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100 transition-colors hover:bg-emerald-100"
                    >
                      <Phone size={13} />
                    </a>
                    <a
                      href={`https://wa.me/${wa}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`WhatsApp ${person.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100 transition-colors hover:bg-emerald-100"
                    >
                      <MessageCircle size={13} />
                    </a>
                  </>
                )}

                {chatPath && (
                  <Link
                    to={chatPath}
                    onClick={onClose}
                    title={`Message ${person.name} in the panel`}
                    className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100 transition-colors hover:bg-blue-100"
                  >
                    <MessageCircle size={12} /> Chat
                  </Link>
                )}

                <a
                  href={`mailto:${person.email}`}
                  title={`Email ${person.name}`}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
                >
                  <Mail size={12} /> Email
                </a>
              </div>
            </div>
          </div>

          {/* --------------------------------------------- the tiles */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {/**
              * The company's own code where there is one, and the tail of the
              * database id where there is not. The second is not an employee
              * id and never was — it is a fallback so the tile is not empty
              * for the thousands of records that predate the field.
              */}
            <Tile
              label="Employee ID"
              value={person.employeeId || String(person._id).slice(-8)}
              hint={person.email}
            />
            <Tile
              label="Department"
              value={person.department || "Not set"}
              hint={person.designation || prettify(person.role)}
              tone="green"
            />
            <Tile label="Joined" value={fmtDate(person.joiningDate)} tone="violet" />
            <Tile
              label="Paperwork"
              value={`${documentsOnFile} of 4 scans`}
              hint={documentsOnFile === 4 ? "Complete" : "Still waiting"}
              tone={documentsOnFile === 4 ? "green" : "amber"}
            />
          </div>

          {/* ----------------------------------------------- the tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active === t.key
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* -------------------------------------------- overview */}
          {active === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon={FolderKanban}
                  label="Projects"
                  value={data?.projects?.length ?? stats.projects ?? 0}
                />
                <StatCard
                  icon={CheckCircle2}
                  label="Tasks completed"
                  value={stats.tasksCompleted ?? 0}
                  tone="green"
                />
                <StatCard
                  icon={Clock}
                  label="Tasks open"
                  value={Math.max(0, (stats.tasksTotal ?? 0) - (stats.tasksCompleted ?? 0))}
                  tone="amber"
                />
                <StatCard
                  icon={CalendarCheck}
                  label="Present this month"
                  value={`${stats.presentThisMonth ?? 0}/${stats.markedThisMonth ?? 0}`}
                  tone="violet"
                />
              </div>

              <WorkRecord person={person} stats={stats} />

              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">Account</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <Permission
                    label="Sign in"
                    state={person.status === "active" ? "Allowed" : "Blocked"}
                    ok={person.status === "active"}
                  />
                  <Permission
                    label="Panel"
                    state={`${prettify(person.role)} portal`}
                    ok={person.status === "active"}
                  />
                  <Permission
                    label="Identity papers"
                    state={documentsOnFile === 4 ? "On file" : `${documentsOnFile} of 4`}
                    ok={documentsOnFile === 4}
                  />
                  <Permission
                    label="Bank details"
                    state={person.bank?.accountNumber ? "On file" : "Not on file"}
                    ok={Boolean(person.bank?.accountNumber)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------- profile */}
          {active === "profile" && (
            <Grid>
              <Row icon={Mail} label="Email" value={person.email} />
              <Row icon={Phone} label="Mobile" value={person.phone} />
              <Row icon={Briefcase} label="Designation" value={person.designation} />
              <Row icon={Building2} label="Department" value={person.department} />
              <Row icon={CalendarDays} label="Joining date" value={fmtDate(person.joiningDate)} />
              <Row icon={CalendarDays} label="Added on" value={fmtDate(person.createdAt)} />
              <Row
                icon={Users}
                label="Reports to"
                value={person.reportsTo?.name || person.reportsToName}
              />
              <Row icon={ShieldCheck} label="Role" value={prettify(person.role)} />

              {/**
                * What HR recorded about the job itself, as opposed to the
                * login. Every one of these is drawn only when it was filled
                * in — a profile of nine "—" rows tells somebody less than a
                * profile of the four things that are actually known.
                */}
              {person.employeeId && (
                <Row icon={IdCard} label="Employee ID" value={person.employeeId} />
              )}
              {person.salesRole && (
                <Row icon={Briefcase} label="Sales role" value={person.salesRole} />
              )}
              {person.workLocation && (
                <Row
                  icon={Building2}
                  label="Work location"
                  value={WORK_LOCATION_LABELS[person.workLocation] || person.workLocation}
                />
              )}
              {person.employmentType && (
                <Row
                  icon={Briefcase}
                  label="Employment type"
                  value={EMPLOYMENT_TYPE_LABELS[person.employmentType] || person.employmentType}
                />
              )}
              {person.teamSize > 0 && (
                <Row icon={Users} label="Team size" value={`${person.teamSize} people`} />
              )}
              {person.address && (
                <div className="sm:col-span-2">
                  <Row icon={MapPin} label="Address" value={person.address} />
                </div>
              )}

              <Chips
                icon={Briefcase}
                label="Work responsibilities"
                items={person.responsibilities}
              />
              <Chips icon={Sparkles} label="Skills" items={person.skills} tone="slate" />
            </Grid>
          )}

          {/* ------------------------------------------- documents */}
          {active === "documents" && (
            <Grid>
              <Row
                icon={IdCard}
                label="Aadhaar number"
                value={person.documents?.aadhaarNumber || "Not on file"}
              />
              <Row
                icon={IdCard}
                label="PAN number"
                value={person.documents?.panNumber || "Not on file"}
              />
              <div className="sm:col-span-2">
                <ScanList
                  label="Scans on file"
                  api={api}
                  docPath={docPath}
                  recordId={person._id}
                  items={[
                    ["aadhaarFront", "Aadhaar — front"],
                    ["aadhaarBack", "Aadhaar — back"],
                    ["panFront", "PAN — front"],
                    ["panBack", "PAN — back"],
                    // Filed with the identity papers — see the model
                    ["resume", "CV"],
                  ].map(([key, label]) => [key, label, person.documents?.[key]])}
                />
              </div>
            </Grid>
          )}

          {/* ------------------------------------------------ bank */}
          {active === "bank" && (
            <Grid>
              <Row
                icon={Banknote}
                label="Account name"
                value={person.bank?.accountName || "Not on file"}
              />
              <Row
                icon={Banknote}
                label="Account number"
                value={person.bank?.accountNumber || "Not on file"}
              />
              <Row icon={Landmark} label="Bank" value={person.bank?.bankName || "Not on file"} />
              <Row icon={Landmark} label="IFSC" value={person.bank?.ifsc || "Not on file"} />
            </Grid>
          )}

          {/* --------------------------------- employment history */}
          {active === "history" && (
            <Grid>
              <Row
                icon={Building2}
                label="Company"
                value={person.previousEmployment?.companyName}
              />
              <Row
                icon={Briefcase}
                label="Designation"
                value={person.previousEmployment?.designation}
              />
              {/* The model calls these from and to. Reading fromDate/toDate
                  here left both dates blank however carefully the form had
                  been filled in. */}
              <Row
                icon={CalendarDays}
                label="From"
                value={fmtDate(person.previousEmployment?.from)}
              />
              <Row
                icon={CalendarDays}
                label="To"
                value={fmtDate(person.previousEmployment?.to)}
              />
              <Row
                icon={Banknote}
                label="Last salary"
                value={person.previousEmployment?.lastSalary}
              />
              <div className="sm:col-span-2">
                {/* The three letters a previous employer hands over. The form
                    has always collected them; this tab never showed them. */}
                <ScanList
                  label="Letters on file"
                  api={api}
                  docPath={docPath}
                  recordId={person._id}
                  items={[
                    ["experienceLetter", "Experience letter"],
                    ["salarySlip", "Salary slip"],
                    ["relievingLetter", "Relieving letter"],
                  ].map(([key, label]) => [key, label, person.previousEmployment?.[key]])}
                />
              </div>
            </Grid>
          )}

          {/* -------------------------------------- projects & tasks */}
          {active === "work" && (
            <div className="space-y-4">
              {/**
               * What the work looks like before reading any of it: how much is
               * done, how much is open, how much is late. The counts come from
               * the server across ALL their tasks, not from the twenty cards
               * below — "3 completed" out of a page of twenty would be a
               * different and wrong sentence.
               */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { label: "Completed", value: stats.tasksCompleted ?? 0, tone: "green" },
                  { label: "Open", value: stats.tasksPending ?? 0, tone: "blue" },
                  { label: "In review", value: stats.tasksInReview ?? 0, tone: "violet" },
                  {
                    label: "Overdue",
                    value: stats.tasksOverdue ?? 0,
                    tone: (stats.tasksOverdue ?? 0) > 0 ? "amber" : "blue",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className={`rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${TILE_TONES[s.tone]}`}
                  >
                    <p className="text-[11px] font-medium opacity-70">{s.label}</p>
                    <p className="mt-0.5 text-xl font-semibold">{s.value}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <FolderKanban size={14} className="text-slate-400" />
                  Projects
                  {data.projects?.length ? (
                    <span className="font-normal text-slate-400">({data.projects.length})</span>
                  ) : null}
                </p>
                {data.projects?.length ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {data.projects.map((p) => (
                      <ProjectCard key={p._id} project={p} />
                    ))}
                  </div>
                ) : (
                  <Empty>Not on any project yet.</Empty>
                )}
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <CheckCircle2 size={14} className="text-slate-400" />
                    Tasks
                  </p>

                  {/**
                   * A filter rather than a second list. "What is still open"
                   * and "what did they finish" are the two questions, and
                   * scrolling a mixed list to answer either is the thing this
                   * tab was bad at.
                   */}
                  <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5">
                    {[
                      ["all", "All"],
                      ["open", "Open"],
                      ["completed", "Completed"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTaskFilter(key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          taskFilter === key
                            ? "bg-blue-50 text-blue-700"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {visibleTasks.length ? (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {visibleTasks.map((t) => (
                      <TaskCard key={t._id} task={t} />
                    ))}
                  </div>
                ) : (
                  <Empty>
                    {taskFilter === "completed"
                      ? "Nothing finished yet."
                      : taskFilter === "open"
                        ? "Nothing open — everything assigned is done."
                        : "Nothing assigned yet."}
                  </Empty>
                )}

                {data.tasks?.length >= 20 && (
                  <p className="mt-2 text-center text-[11px] text-slate-400">
                    Showing their twenty most recent tasks.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------- leave & attendance */}
          {active === "leave" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {Object.entries(data.attendance || {}).map(([key, value]) => (
                  <Tile
                    key={key}
                    label={prettify(key)}
                    value={value}
                    tone={key === "present" ? "green" : key === "absent" ? "amber" : "blue"}
                  />
                ))}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">
                  Leave
                  {stats.leaveTakenThisYear !== undefined && (
                    <span className="ml-1.5 font-normal text-slate-500">
                      · {stats.leaveTakenThisYear} days taken this year
                    </span>
                  )}
                </p>
                {data.leaves?.length ? (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {data.leaves.map((l) => (
                      <div key={l._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-900">
                            {prettify(l.type)} · {l.days} day{l.days === 1 ? "" : "s"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {fmtDate(l.fromDate)} — {fmtDate(l.toDate)}
                            {l.reason ? ` · ${l.reason}` : ""}
                          </p>
                        </div>
                        <Badge value={prettify(l.status)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>No leave on record.</Empty>
                )}
              </div>
            </div>
          )}

          {/* ----------------------------------------------- salary */}
          {active === "salary" && (
            <SalaryTab
              api={api}
              basePath={basePath}
              employeeId={person._id}
              canEdit={canEditSalary}
            />
          )}

          {/* ------------------------------------------------ login */}
          {active === "login" && <Credentials credentials={data.credentials} />}
        </div>
      )}
    </Modal>
  );
}
