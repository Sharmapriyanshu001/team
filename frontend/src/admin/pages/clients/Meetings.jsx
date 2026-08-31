import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  RefreshCw,
  Video,
  X,
} from "lucide-react";

import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
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
  Select,
  Textarea,
} from "../../../shared/components/ui";

const MODE_ICONS = { online: Video, office: Building2, site: MapPin };

// The palette in ui.jsx is five tones — anything else renders untoned
const STATUS_TONES = {
  requested: "sky",
  scheduled: "blue",
  completed: "black",
  cancelled: "slate",
};

const TABS = [
  { key: "requested", label: "Requests" },
  { key: "scheduled", label: "Confirmed" },
  { key: "completed", label: "Done" },
  { key: "all", label: "Everything" },
];

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";

const toLocalInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  // datetime-local wants the wall clock, not UTC — subtracting the offset is
  // what stops a 4pm meeting rendering as 10:30am in the box
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const isLink = (value = "") => /^https?:\/\//i.test(value);

/**
 * Client meetings, from the company's side.
 *
 * A client could always ask for a meeting; until this screen there was nowhere
 * to answer one. The request arrived as a notification and then lived only in
 * the client's own portal, so the join link — which is created the moment the
 * request is made — had nobody to click it.
 *
 * The join button is the point of the page and is treated that way: it is on
 * every online meeting that has a link, whatever its status, because being
 * able to get into the call does not depend on somebody having pressed
 * Confirm first.
 */
export default function AdminMeetings() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [tab, setTab] = useState("requested");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState("");

  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [copied, setCopied] = useState("");

  const [reloadKey, setReloadKey] = useState(0);

  /**
   * The fetch sets no state on the way in — whatever caused the refetch turns
   * `loading` on itself. Same shape as the shared crud hook, and for the same
   * reason: a setState in the body of an effect costs a render before the
   * request has even left.
   */
  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/meetings", { params: { status: tab } })
      .then(({ data }) => {
        if (!active) return;
        setItems(data.items || []);
        setSummary(data.summary || {});
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setError(err.response?.data?.message || "Could not load meetings");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [tab, reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  const switchTab = (next) => {
    setLoading(true);
    setTab(next);
  };

  const patch = async (meeting, payload, message) => {
    setBusyId(meeting._id);
    try {
      const { data } = await adminApi.put(`/admin/meetings/${meeting._id}`, payload);
      setSuccess(message || data.message || "Meeting updated");
      setError("");
      setEditing(null);
      setCancelling(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update that meeting");
    } finally {
      setBusyId("");
    }
  };

  const newLink = async (meeting) => {
    setBusyId(meeting._id);
    try {
      const { data } = await adminApi.post(`/admin/meetings/${meeting._id}/link`);
      setSuccess(data.message || "New link created");
      setError("");
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not make a new link");
    } finally {
      setBusyId("");
    }
  };

  const copy = async (meeting) => {
    try {
      await navigator.clipboard.writeText(meeting.location);
      setCopied(meeting._id);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      // Clipboard can be blocked; the link is on screen either way
    }
  };

  return (
    <div>
      <PageHeader
        title="Meetings"
        subtitle="What clients have asked for — join, confirm, move or close"
      />

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => switchTab(item.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === item.key
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {item.label}
            {item.key === "requested" && summary.requested > 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  tab === item.key ? "bg-white/20" : "bg-amber-100 text-amber-800"
                }`}
              >
                {summary.requested}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <Loader label="Loading meetings…" />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Nothing here"
            message={
              tab === "requested"
                ? "When a client asks for a meeting, it lands here with a link to join."
                : "No meetings match this tab yet."
            }
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {items.map((meeting) => {
            const ModeIcon = MODE_ICONS[meeting.mode] || CalendarClock;
            const busy = busyId === meeting._id;
            const joinable = meeting.mode === "online" && isLink(meeting.location);
            const open = ["requested", "scheduled"].includes(meeting.status);

            return (
              <Card key={meeting._id} className={`p-4 ${busy ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <ModeIcon size={18} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{meeting.title}</p>
                      <Badge tone={STATUS_TONES[meeting.status] || "slate"}>
                        {meeting.status}
                      </Badge>
                      {meeting.requestedByClient && (
                        <Badge tone="slate">Asked for by the client</Badge>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {meeting.client?.name}
                      {meeting.client?.company ? ` · ${meeting.client.company}` : ""}
                      {meeting.project?.name ? ` · ${meeting.project.name}` : ""}
                    </p>

                    <p className="mt-1 text-xs text-slate-600">
                      {formatWhen(meeting.scheduledAt)} · {meeting.durationMinutes} min ·{" "}
                      {meeting.mode}
                    </p>

                    {meeting.agenda && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{meeting.agenda}</p>
                    )}

                    {/* The link itself, readable — an admin on a call often
                        has to paste it to somebody who is not in this panel */}
                    {joinable && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="truncate rounded-md bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
                          {meeting.location}
                        </span>
                        <button
                          type="button"
                          onClick={() => copy(meeting)}
                          title="Copy link"
                          className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                        >
                          {copied === meeting._id ? (
                            <Check size={13} className="text-blue-600" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                        {open && (
                          <button
                            type="button"
                            onClick={() => newLink(meeting)}
                            title="Make a new link"
                            className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                      </div>
                    )}

                    {!joinable && meeting.location && (
                      <p className="mt-2 text-xs text-slate-500">{meeting.location}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-slate-100 pt-3">
                  {joinable && (
                    <Button
                      size="sm"
                      onClick={() => window.open(meeting.location, "_blank", "noopener")}
                    >
                      <Video size={13} />
                      Join meeting
                      <ExternalLink size={12} />
                    </Button>
                  )}

                  {meeting.status === "requested" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => patch(meeting, { status: "scheduled" }, "Meeting confirmed")}
                    >
                      <Check size={13} />
                      Confirm
                    </Button>
                  )}

                  {meeting.status === "scheduled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => patch(meeting, { status: "completed" }, "Meeting closed")}
                    >
                      <Check size={13} />
                      Mark done
                    </Button>
                  )}

                  {open && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(meeting)}>
                        <CalendarClock size={13} />
                        Reschedule
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setCancelling(meeting)}>
                        <X size={13} />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <RescheduleModal
          meeting={editing}
          loading={busyId === editing._id}
          onClose={() => setEditing(null)}
          onSave={(payload) => patch(editing, payload, "Meeting updated")}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this meeting"
        message={`Cancel "${cancelling?.title}"? ${cancelling?.client?.name || "The client"} is told straight away.`}
        confirmLabel="Cancel meeting"
        loading={busyId === cancelling?._id}
        onConfirm={() => patch(cancelling, { status: "cancelled" }, "Meeting cancelled")}
        onClose={() => setCancelling(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ reschedule */

function RescheduleModal({ meeting, loading, onClose, onSave }) {
  const [form, setForm] = useState({
    scheduledAt: toLocalInput(meeting.scheduledAt),
    durationMinutes: String(meeting.durationMinutes || 30),
    mode: meeting.mode,
    location: meeting.location || "",
    notes: meeting.notes || "",
  });

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // Switching to or from online changes the link, and the server does it —
  // sending the old one back would put a Meet URL on an office meeting
  const modeChanged = form.mode !== meeting.mode;

  return (
    <Modal
      open
      title="Reschedule"
      subtitle={meeting.title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={loading}
            disabled={!form.scheduledAt}
            onClick={() =>
              onSave({
                scheduledAt: form.scheduledAt,
                durationMinutes: Number(form.durationMinutes),
                mode: form.mode,
                notes: form.notes,
                ...(modeChanged ? {} : { location: form.location }),
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="When" required>
          <Input
            name="scheduledAt"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={change}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="How long">
            <Select
              name="durationMinutes"
              value={form.durationMinutes}
              onChange={change}
              options={[
                { value: "15", label: "15 minutes" },
                { value: "30", label: "30 minutes" },
                { value: "45", label: "45 minutes" },
                { value: "60", label: "1 hour" },
              ]}
            />
          </Field>

          <Field label="How">
            <Select
              name="mode"
              value={form.mode}
              onChange={change}
              options={[
                { value: "online", label: "Online call" },
                { value: "office", label: "At the office" },
                { value: "site", label: "On site" },
              ]}
            />
          </Field>
        </div>

        {modeChanged ? (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 ring-1 ring-inset ring-blue-100">
            {form.mode === "online"
              ? "A new joining link is made when you save, and the client is told."
              : "The joining link is dropped — put the address in after saving."}
          </p>
        ) : (
          <Field
            label={form.mode === "online" ? "Joining link" : "Address"}
            hint={
              form.mode === "online"
                ? "Paste a real Meet link here to replace the generated one"
                : "Where the client should come"
            }
          >
            <Input name="location" value={form.location} onChange={change} />
          </Field>
        )}

        <Field label="Notes" hint="Only the company sees these.">
          <Textarea name="notes" rows={2} value={form.notes} onChange={change} />
        </Field>
      </div>
    </Modal>
  );
}
