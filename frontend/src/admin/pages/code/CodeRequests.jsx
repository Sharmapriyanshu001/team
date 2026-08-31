import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clock,
  FileCode2,
  Inbox,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import adminApi from "../../adminApi";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Textarea,
} from "../../../shared/components/ui";

/**
 * Requests & Bin — the admin's side of "nothing important happens without me".
 *
 * Two things live here because they are the same decision seen from two ends:
 * what people have asked for, and what has been deleted but not yet destroyed.
 * A team leader asking for a project to go, the admin agreeing, and the files
 * finally being removed are three separate acts, and this is where the last
 * two happen.
 */

const STATUS_TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Declined" },
  { key: "all", label: "All" },
];

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const formatWhen = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Whoever did it, in words. The bin sees admins here as well as assignees,
// so this cannot assume one of two.
const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  team_leader: "Team Leader",
  employee: "Employee",
};

const roleLabel = (role) => ROLE_LABELS[role] || "—";

export default function CodeRequests() {
  const [tab, setTab] = useState("requests");

  const [status, setStatus] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const [binned, setBinned] = useState([]);
  const [binLoading, setBinLoading] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState("");

  // The two things that need a sentence typed before they happen
  const [deciding, setDeciding] = useState(null); // { request, decision }
  const [purging, setPurging] = useState(null); // the project being destroyed

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const { data } = await adminApi.get(`/admin/code-projects/requests?status=${status}`);
      setRequests(data.items || []);
      setPendingCount(data.pendingCount || 0);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the request queue");
    } finally {
      setRequestsLoading(false);
    }
  }, [status]);

  const loadBin = useCallback(async () => {
    setBinLoading(true);
    try {
      const { data } = await adminApi.get("/admin/code-projects?view=trash&limit=100");
      setBinned(data.items || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the bin");
    } finally {
      setBinLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    loadBin();
  }, [loadBin]);

  /* ------------------------------------------------------------ decisions */

  const decide = async (note) => {
    if (!deciding) return;
    const { request, decision } = deciding;

    setBusyId(request._id);
    try {
      const { data } = await adminApi.post(
        `/admin/code-projects/requests/${request._id}/${decision}`,
        { note }
      );
      setSuccess(data.message || "Done");
      setDeciding(null);
      // Approving a delete request moves a project into the bin, so both
      // lists can be out of date after one click
      await Promise.all([loadRequests(), loadBin()]);
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that decision");
      setDeciding(null);
    } finally {
      setBusyId("");
    }
  };

  const restore = async (project) => {
    setBusyId(project._id);
    try {
      const { data } = await adminApi.post(`/admin/code-projects/${project._id}/restore`);
      setSuccess(data.message || "Restored");
      setBinned((prev) => prev.filter((row) => row._id !== project._id));
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not restore that project");
    } finally {
      setBusyId("");
    }
  };

  const purge = async (confirm) => {
    if (!purging) return;

    setBusyId(purging._id);
    try {
      const { data } = await adminApi.delete(
        `/admin/code-projects/${purging._id}/permanent`,
        { data: { confirm } }
      );
      setSuccess(data.message || "Deleted for good");
      setBinned((prev) => prev.filter((row) => row._id !== purging._id));
      setPurging(null);
      setError("");
      loadRequests();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that project");
      setPurging(null);
    } finally {
      setBusyId("");
    }
  };

  /* ----------------------------------------------------------------- view */

  return (
    <div>
      <PageHeader
        title="Requests & Bin"
        subtitle="What your team has asked for, and what has been deleted but not yet destroyed"
      />

      <Alert>{error}</Alert>
      {success && <Alert tone="success">{success}</Alert>}

      <div className="mb-4 flex gap-1.5">
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          <Inbox size={14} />
          Requests
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {pendingCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "bin"} onClick={() => setTab("bin")}>
          <Trash2 size={14} />
          Bin
          {binned.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
              {binned.length}
            </span>
          )}
        </TabButton>
      </div>

      {tab === "requests" ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {STATUS_TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setStatus(entry.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                  status === entry.key
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {requestsLoading ? (
            <Card>
              <Loader label="Loading requests…" />
            </Card>
          ) : !requests.length ? (
            <Card>
              <EmptyState
                icon={Inbox}
                title={status === "pending" ? "Nothing waiting on you" : "Nothing here"}
                message={
                  status === "pending"
                    ? "When a team leader or employee asks to change or delete a code project, it lands here."
                    : "No requests match that filter."
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3">
              {requests.map((request) => (
                <RequestCard
                  key={request._id}
                  request={request}
                  busy={busyId === request._id}
                  onDecide={(decision) => setDeciding({ request, decision })}
                />
              ))}
            </div>
          )}
        </>
      ) : binLoading ? (
        <Card>
          <Loader label="Loading the bin…" />
        </Card>
      ) : !binned.length ? (
        <Card>
          <EmptyState
            icon={Trash2}
            title="The bin is empty"
            message="Deleted code projects wait here until you restore them or delete them for good."
          />
        </Card>
      ) : (
        <>
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
            These projects are hidden from everyone assigned to them and cannot be edited or run,
            but every file is still on the server. Restoring one puts it back exactly as it was.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {binned.map((project) => (
              <BinCard
                key={project._id}
                project={project}
                busy={busyId === project._id}
                onRestore={() => restore(project)}
                onPurge={() => setPurging(project)}
              />
            ))}
          </div>
        </>
      )}

      {deciding && (
        <DecisionModal
          request={deciding.request}
          decision={deciding.decision}
          loading={Boolean(busyId)}
          onConfirm={decide}
          onClose={() => setDeciding(null)}
        />
      )}

      {purging && (
        <PurgeModal
          project={purging}
          loading={Boolean(busyId)}
          onConfirm={purge}
          onClose={() => setPurging(null)}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
        active
          ? "bg-white text-slate-900 ring-slate-300 shadow-sm"
          : "bg-transparent text-slate-500 ring-transparent hover:bg-white/60"
      }`}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- requests */

function RequestCard({ request, busy, onDecide }) {
  const isDelete = request.type === "delete";
  const pending = request.status === "pending";
  const changes = request.changes || {};

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            isDelete ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
          }`}
        >
          {isDelete ? <Trash2 size={16} /> : <FileCode2 size={16} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">
              {isDelete ? "Delete" : "Edit"} · {request.projectName || "—"}
            </p>
            <Badge value={request.status} />
            {request.codeProject?.deletedAt && <Badge tone="slate">in the bin</Badge>}
          </div>

          <p className="mt-0.5 text-xs text-slate-500">
            {request.requestedBy?.name || "Someone"} ·{" "}
            {roleLabel(request.requestedByRole || request.requestedBy?.role)} ·{" "}
            {formatWhen(request.createdAt)}
          </p>

          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
            {request.reason}
          </p>

          {!isDelete && (changes.name || changes.description) && (
            <dl className="mt-2 space-y-1 text-sm">
              {changes.name && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs text-slate-400">New name</dt>
                  <dd className="text-slate-800">{changes.name}</dd>
                </div>
              )}
              {changes.description && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs text-slate-400">New description</dt>
                  <dd className="text-slate-800">{changes.description}</dd>
                </div>
              )}
            </dl>
          )}

          {!pending && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <Clock size={12} />
              {request.status === "approved" ? "Approved" : "Declined"} by{" "}
              {request.decidedBy?.name || "an admin"} · {formatWhen(request.decidedAt)}
              {request.decisionNote && <span className="text-slate-700">— {request.decisionNote}</span>}
            </p>
          )}
        </div>

        {pending && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("reject")}>
              <X size={13} />
              Decline
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onDecide("approve")}>
              <Check size={13} />
              Approve
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function DecisionModal({ request, decision, loading, onConfirm, onClose }) {
  const [note, setNote] = useState("");
  const approving = decision === "approve";
  const isDelete = request.type === "delete";

  return (
    <Modal
      open
      title={approving ? "Approve this request" : "Decline this request"}
      subtitle={`${isDelete ? "Delete" : "Edit"} · ${request.projectName}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approving && isDelete ? "danger" : "primary"}
            loading={loading}
            onClick={() => onConfirm(note.trim())}
          >
            {approving ? "Approve" : "Decline"}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">
        {approving
          ? isDelete
            ? "The project moves to the bin. Everyone assigned to it loses access straight away, but nothing is destroyed — you can restore it, or delete it for good from the Bin tab."
            : "The change is applied to the project immediately."
          : "The project is left exactly as it is."}
      </p>

      <Field label="Note back to them" className="mt-3" hint="They see this with the decision.">
        <Textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={approving ? "Optional" : "Why not? Optional, but kinder."}
        />
      </Field>
    </Modal>
  );
}

/* -------------------------------------------------------------------- bin */

/**
 * One project in the bin.
 *
 * The admin deciding whether to restore or destroy needs to know more than the
 * name: who deleted it and in what capacity, when, and who is still assigned —
 * an employee deleting a project three people are working on is a different
 * situation from an admin tidying up their own upload.
 */
function BinCard({ project, busy, onRestore, onPurge }) {
  const team = [...(project.teamLeaders || []), ...(project.employees || [])];
  const deletedBy = project.deletedBy;
  const role = project.deletedByRole || deletedBy?.role;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileCode2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-slate-900">{project.name}</p>
            <Badge tone={role && role !== "admin" && role !== "super_admin" ? "red" : "slate"}>
              {roleLabel(role)}
            </Badge>
          </div>
          <p className="truncate text-xs text-slate-400">
            {project.stack} · {project.fileCount} files · {formatSize(project.totalSize)}
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
        <Row label="Deleted by" value={deletedBy?.name || "—"} />
        <Row label="Their role" value={roleLabel(role)} />
        <Row label="Deleted at" value={formatWhen(project.deletedAt) || "—"} />
        <Row
          label="Assigned to"
          value={
            team.length
              ? team.map((person) => person.name).filter(Boolean).join(", ")
              : "Nobody"
          }
        />
        {project.project?.name && <Row label="Project" value={project.project.name} />}
        {project.deleteReason && <Row label="Reason" value={project.deleteReason} />}
      </dl>

      <div className="mt-3 flex justify-end gap-1.5 border-t border-slate-100 pt-3">
        <Button size="sm" variant="outline" loading={busy} onClick={onRestore}>
          <RotateCcw size={13} />
          Restore
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onPurge}>
          <Trash2 size={13} />
          Delete for good
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-700">{value}</dd>
    </div>
  );
}

/**
 * The only screen in the app that destroys anything.
 *
 * The typed name is not decoration: the server refuses the request without it,
 * so this dialog and the API agree on what counts as confirmation instead of
 * the safety living only in the browser.
 */
function PurgeModal({ project, loading, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === project.name;

  return (
    <Modal
      open
      title="Delete for good"
      subtitle={project.name}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={!matches}
            onClick={() => onConfirm(typed.trim())}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="flex gap-2.5 rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-relaxed text-red-800 ring-1 ring-inset ring-red-100">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <p>
          The workspace, every saved version and the original upload are removed from the server.
          There is no way back from this — not from the bin, not from a backup of the database.
        </p>
      </div>

      <Field
        label="Type the project's name to confirm"
        className="mt-3"
        hint={project.name}
        required
      >
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={project.name}
          autoFocus
        />
      </Field>

      {typed && !matches && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <ShieldAlert size={12} />
          That does not match yet.
        </p>
      )}
    </Modal>
  );
}
