import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ClipboardCheck,
  Eye,
  FileCode,
  GitBranch,
  ListChecks,
  RotateCcw,
  User,
} from "lucide-react";

import leaderApi from "../leaderApi";
import Modal from "../../shared/components/Modal";
import CodeViewer from "../../shared/components/CodeViewer";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Loader,
  PageHeader,
  Textarea,
} from "../../shared/components/ui";

/**
 * Code Reviews — what this leader's own team has sent them.
 *
 * Separate from "Shared Code", which is what the admin handed over and is
 * read-only. This list is work waiting on a decision, and the two actions are
 * the only two a leader has: sign it off, or send it back with a comment.
 * Refusing a submission outright stays the admin's, because the admin owns
 * the project.
 */

const TABS = [
  { key: "pending", label: "Waiting on you" },
  { key: "changes_required", label: "Sent back" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
];

const formatWhen = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function CodeReviews() {
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState([]);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [viewing, setViewing] = useState(null);
  const [deciding, setDeciding] = useState(null); // { row, decision }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await leaderApi.get(`/leader/code/review?status=${status}`);
      setItems(data.items || []);
      setWaiting(data.waiting || 0);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load your review queue");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (note) => {
    if (!deciding) return;
    const { row, decision } = deciding;

    setSaving(true);
    try {
      const { data } = await leaderApi.put(`/leader/code/${row._id}/review`, { decision, note });
      setSuccess(data.message || "Review saved");
      setError("");
      setDeciding(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save that review");
      setDeciding(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Code Reviews"
        subtitle="Work your team submitted — approve it, or send it back with what needs changing"
      />

      <Alert>{error}</Alert>
      {success && <Alert tone="success">{success}</Alert>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatus(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              status === tab.key
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {tab.label}
            {tab.key === "pending" && waiting > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-semibold ${
                  status === tab.key ? "bg-white/20" : "bg-blue-600 text-white"
                }`}
              >
                {waiting}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <Loader label="Loading your review queue…" />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title={status === "pending" ? "Nothing waiting on you" : "Nothing here"}
            message={
              status === "pending"
                ? "When somebody on your team submits code, it lands here for review."
                : "No submissions match that filter."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((row) => (
            <SubmissionCard
              key={row._id}
              row={row}
              onView={() => setViewing(row._id)}
              onDecide={(decision) => setDeciding({ row, decision })}
            />
          ))}
        </div>
      )}

      {viewing && (
        <CodeViewer
          key={viewing}
          api={leaderApi}
          base="/leader"
          id={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {deciding && (
        <DecisionModal
          row={deciding.row}
          decision={deciding.decision}
          loading={saving}
          onConfirm={decide}
          onClose={() => setDeciding(null)}
        />
      )}
    </div>
  );
}

function SubmissionCard({ row, onView, onDecide }) {
  const pending = row.status === "pending";
  const latest = (row.versions || [])[(row.versions || []).length - 1];

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <FileCode size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{row.title}</p>
            <Badge value={row.status} />
            <Badge tone="slate">
              <span className="inline-flex items-center gap-1">
                <GitBranch size={10} />v{row.latestVersion}
              </span>
            </Badge>
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <User size={11} />
              {row.submittedBy?.name || "Someone"}
            </span>
            {row.project?.name && <span>{row.project.name}</span>}
            {row.task?.title && (
              <span className="inline-flex items-center gap-1">
                <ListChecks size={11} />
                {row.task.title}
              </span>
            )}
            <span>{formatWhen(row.updatedAt)}</span>
          </p>

          {row.description && (
            <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{row.description}</p>
          )}

          {latest?.note && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
              <span className="text-xs text-slate-400">Their note: </span>
              {latest.note}
            </p>
          )}

          {!pending && row.reviewNote && (
            <p className="mt-2 text-xs text-slate-500">
              Your comment: <span className="text-slate-700">{row.reviewNote}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onView}>
            <Eye size={13} />
            View code
          </Button>
          {pending && (
            <>
              <Button size="sm" variant="danger" onClick={() => onDecide("changes")}>
                <RotateCcw size={13} />
                Request changes
              </Button>
              <Button size="sm" onClick={() => onDecide("approve")}>
                <Check size={13} />
                Approve
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function DecisionModal({ row, decision, loading, onConfirm, onClose }) {
  const [note, setNote] = useState("");
  const approving = decision === "approve";

  // The server refuses a bare send-back, so the button says so before they try
  const blocked = !approving && !note.trim();

  return (
    <Modal
      open
      title={approving ? "Approve this submission" : "Send it back for changes"}
      subtitle={`${row.title} · v${row.latestVersion}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approving ? "primary" : "danger"}
            loading={loading}
            disabled={blocked}
            onClick={() => onConfirm(note.trim())}
          >
            {approving ? "Approve" : "Request changes"}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">
        {approving
          ? row.task?.title
            ? `This version is signed off, and "${row.task.title}" is marked complete.`
            : "This version is signed off."
          : "They keep the submission and add a new version to it — nothing is deleted, and anything you approved before stays approved."}
      </p>

      <Field
        label={approving ? "Note back to them" : "What needs changing"}
        className="mt-3"
        required={!approving}
        hint="They see this on their own screen."
      >
        <Textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={approving ? "Optional" : "e.g. the login form still accepts an empty password"}
        />
      </Field>

      {blocked && (
        <p className="mt-1.5 text-xs text-slate-500">
          Say what needs changing — they cannot act on a bare rejection.
        </p>
      )}
    </Modal>
  );
}
