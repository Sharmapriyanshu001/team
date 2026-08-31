import { useState } from "react";
import { Plus, CalendarClock, Video, Building2, MapPin, X, ExternalLink } from "lucide-react";

import clientApi from "../clientApi";
import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { prettify, initialsOf } from "../../shared/format";
import Modal, { ConfirmDialog } from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";

const MODE_ICONS = { online: Video, office: Building2, site: MapPin };

const EMPTY = {
  title: "",
  agenda: "",
  project: "",
  scheduledAt: "",
  durationMinutes: 30,
  mode: "online",
};

const when = (value) =>
  new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// The datetime-local input needs a local-time string, not an ISO/UTC one
const defaultSlot = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(11, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
};

const GROUPS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "requested", label: "Awaiting confirmation" },
  { key: "past", label: "Past" },
];

export default function Meetings() {
  const crud = useCrud("meetings");
  const lookups = useLookups();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, scheduledAt: defaultSlot() });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const [target, setTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleRequest = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await crud.create({
        ...form,
        durationMinutes: Number(form.durationMinutes) || 30,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
      });
      setOpen(false);
      setForm({ ...EMPTY, scheduledAt: defaultSlot() });
      setSuccess("Request sent — the team will confirm a time with you.");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send the request");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await clientApi.put(`/client/meetings/${target._id}/cancel`);
      setTarget(null);
      setSuccess("Meeting cancelled.");
      crud.refresh();
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not cancel the meeting");
    } finally {
      setCancelling(false);
    }
  };

  const now = new Date();
  const grouped = {
    upcoming: crud.rows.filter((m) => m.status === "scheduled" && new Date(m.scheduledAt) >= now),
    requested: crud.rows.filter((m) => m.status === "requested"),
    past: crud.rows.filter(
      (m) =>
        m.status === "completed" ||
        m.status === "cancelled" ||
        (m.status === "scheduled" && new Date(m.scheduledAt) < now)
    ),
  };

  return (
    <div>
      <PageHeader
        title="Meetings"
        subtitle="Scheduled reviews and site visits — request a new one any time"
      >
        <Button onClick={() => setOpen(true)}>
          <Plus size={15} />
          Request Meeting
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>
      <Alert tone="success">{success}</Alert>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GROUPS.map((group) => (
          <Card key={group.key} className="p-5">
            <p className="text-xs font-medium text-slate-500">{group.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{grouped[group.key].length}</p>
          </Card>
        ))}
      </div>

      {crud.loading ? (
        <Loader />
      ) : !crud.rows.length ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No meetings yet"
            message="Request a review call or a site visit and the team will confirm a time."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {GROUPS.map((group) => {
            const list = grouped[group.key];
            if (!list.length) return null;

            return (
              <Card key={group.key}>
                <CardHeader title={group.label} subtitle={`${list.length} meetings`} />
                <div className="divide-y divide-slate-100">
                  {list.map((meeting) => {
                    const ModeIcon = MODE_ICONS[meeting.mode] || CalendarClock;
                    const canCancel = ["requested", "scheduled"].includes(meeting.status);

                    return (
                      <div key={meeting._id} className="flex flex-wrap gap-4 p-5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <ModeIcon size={18} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-900">{meeting.title}</p>
                            <Badge
                              tone={
                                meeting.status === "scheduled"
                                  ? "blue"
                                  : meeting.status === "completed"
                                    ? "black"
                                    : meeting.status === "cancelled"
                                      ? "slate"
                                      : "sky"
                              }
                            >
                              {prettify(meeting.status)}
                            </Badge>
                            {meeting.requestedByClient && (
                              <Badge tone="slate">Requested by you</Badge>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-slate-500">
                            {when(meeting.scheduledAt)} · {meeting.durationMinutes} min ·{" "}
                            {prettify(meeting.mode)}
                          </p>

                          {meeting.project && (
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {meeting.project.name}
                            </p>
                          )}

                          {meeting.agenda && (
                            <p className="mt-2 text-sm text-slate-600">{meeting.agenda}</p>
                          )}

                          {meeting.notes && (
                            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <span className="font-medium">Notes: </span>
                              {meeting.notes}
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {meeting.organizer && (
                              <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-semibold text-white">
                                  {initialsOf(meeting.organizer.name)}
                                </span>
                                {meeting.organizer.name}
                              </span>
                            )}

                            {/* Shown while the meeting is still only asked
                                for, as well as once it is confirmed: the link
                                exists from the moment the request is made, and
                                a client who can see the call is a client who
                                can be joined without waiting on a Confirm. */}
                            {meeting.location &&
                              ["requested", "scheduled"].includes(meeting.status) && (
                              meeting.location.startsWith("http") ? (
                                <a
                                  href={meeting.location}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
                                >
                                  Join meeting
                                  <ExternalLink size={11} />
                                </a>
                              ) : (
                                <span className="text-[11px] text-slate-500">
                                  {meeting.location}
                                </span>
                              )
                              )}
                          </div>
                        </div>

                        {canCancel && (
                          <Button size="sm" variant="outline" onClick={() => setTarget(meeting)}>
                            <X size={13} />
                            Cancel
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        title="Request a meeting"
        subtitle="Pick a time that suits you — the team will confirm or suggest another"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleRequest}>
              Send request
            </Button>
          </>
        }
      >
        <form onSubmit={handleRequest} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Alert>{formError}</Alert>

          <Field label="What is it about?" required className="sm:col-span-2">
            <Input
              name="title"
              value={form.title}
              onChange={change}
              required
              placeholder="Weekly progress review"
            />
          </Field>

          <Field label="Project" hint="Leave blank if it covers everything">
            <Select
              name="project"
              value={form.project}
              onChange={change}
              placeholder="All projects"
              options={lookups.projectOptions}
            />
          </Field>

          <Field label="How should we meet?">
            <Select
              name="mode"
              value={form.mode}
              onChange={change}
              options={[
                { value: "online", label: "Online call" },
                { value: "office", label: "At your office" },
                { value: "site", label: "On site" },
              ]}
            />
          </Field>

          <Field label="Preferred time" required>
            <Input
              name="scheduledAt"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={change}
              required
            />
          </Field>

          <Field label="How long?">
            <Select
              name="durationMinutes"
              value={form.durationMinutes}
              onChange={change}
              options={[
                { value: 15, label: "15 minutes" },
                { value: 30, label: "30 minutes" },
                { value: 45, label: "45 minutes" },
                { value: 60, label: "1 hour" },
                { value: 90, label: "1.5 hours" },
              ]}
            />
          </Field>

          <Field label="Agenda" className="sm:col-span-2">
            <Textarea
              name="agenda"
              value={form.agenda}
              onChange={change}
              rows={3}
              placeholder="Points you would like covered."
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Cancel meeting"
        message={`Cancel "${target?.title}"? The team will be notified.`}
        confirmLabel="Cancel meeting"
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
