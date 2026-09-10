import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, MessageSquare, Plus, UserPlus, XCircle } from "lucide-react";

import Modal from "../components/Modal";
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
  ProgressBar,
  Select,
  Textarea,
} from "../components/ui";
import { prettify } from "../format";

/**
 * Changes a client asked for, from whichever side you are on.
 *
 * One screen for four panels, in the shape the attendance sheet and the
 * departments page already use here: the server decides what this account may
 * do with each row and says so in `can`, and the buttons follow that rather
 * than re-deriving it from a role prop. A panel that gets the component wrong
 * therefore cannot offer an action the server will refuse — the worst it can
 * do is show a read-only list.
 *
 * The thread is the point. A status on its own says a change was declined; the
 * thread says who declined it, when, and what they said — which is the thing
 * anybody actually goes looking for three weeks later.
 */

const STATUS_TONE = {
  open: "amber",
  in_progress: "blue",
  completed: "green",
  rejected: "red",
};

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "red" };

const BLANK = { project: "", title: "", detail: "", priority: "medium" };

const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/**
 * @param api        the panel's axios instance
 * @param basePath   e.g. "/client", "/employee", "/leader", "/admin"
 * @param projects   [{ _id, name }] — only needed where a request can be raised
 *
 * Who a request can be assigned to is NOT a prop. It is the project's own
 * roster and it changes per request, so the server sends it with the request
 * — see assignableTo in the controller. A panel-level list would offer names
 * the assign handler is going to refuse.
 */
export default function ChangeRequestsPage({ api, basePath, title, subtitle, projects = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(null);
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  // The reply box on an open request
  const [reply, setReply] = useState({ note: "", progress: "" });
  // Who this particular request may go to, as the server sees it
  const [people, setPeople] = useState([]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setData(null);

    api
      .get(`${basePath}/change-requests`, {
        params: {
          view: view === "all" ? undefined : view,
          status: status === "all" ? undefined : status,
          search: search || undefined,
        },
      })
      .then(({ data: d }) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch((err) =>
        active && setError(err.response?.data?.message || "Could not load change requests")
      );

    return () => {
      active = false;
    };
  }, [api, basePath, view, status, search, reloadKey]);

  /** Opening one fetches the thread — the list carries the row, not its history. */
  const openRequest = async (row) => {
    try {
      const { data: d } = await api.get(`${basePath}/change-requests/${row._id}`);
      setOpen(d.item);
      setPeople(d.assignableTo || []);
      setReply({ note: "", progress: String(d.item.progress ?? "") });
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that");
    }
  };

  const raise = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const { data: d } = await api.post(`${basePath}/change-requests`, form);
      setNotice(d.message || "Sent");
      setRaising(false);
      setForm(BLANK);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send that");
    } finally {
      setBusy(false);
    }
  };

  /**
   * One call for every move: a note, a progress figure, a decision, or any
   * combination. The server ignores what this account may not change, so the
   * screen does not have to build a different request per role.
   */
  const push = async (patch) => {
    if (!open) return;
    setBusy(true);
    try {
      const { data: d } = await api.put(`${basePath}/change-requests/${open._id}`, {
        note: reply.note || undefined,
        ...patch,
      });
      setOpen(d.item);
      setReply({ note: "", progress: String(d.item.progress ?? "") });
      setNotice(d.message || "Saved");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  const assign = async (assignedTo) => {
    if (!open || !assignedTo) return;
    setBusy(true);
    try {
      const { data: d } = await api.put(`${basePath}/change-requests/${open._id}/assign`, {
        assignedTo,
      });
      setOpen(d.item);
      setNotice(d.message || "Assigned");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not assign that");
    } finally {
      setBusy(false);
    }
  };

  const canRaise = data?.can?.create && projects.length > 0;
  const isClient = data?.audience === "client";

  return (
    <div className="space-y-4">
      <PageHeader
        title={title || "Change requests"}
        subtitle={
          subtitle ||
          (isClient
            ? "Ask for a change, and follow what happens to it"
            : "What clients have asked to be changed, and where each one stands")
        }
      >
        <Select
          value={view}
          onChange={(e) => setView(e.target.value)}
          className="w-40"
          options={[
            { value: "all", label: "Everything" },
            { value: "open", label: "Still outstanding" },
            ...(isClient ? [] : [{ value: "mine", label: "Assigned to me" }]),
            ...(data?.can?.manage ? [{ value: "unassigned", label: "Nobody on it" }] : []),
          ]}
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-36"
          options={[
            { value: "all", label: "Any status" },
            ...["open", "in_progress", "completed", "rejected"].map((s) => ({
              value: s,
              label: prettify(s),
            })),
          ]}
        />
        {canRaise && (
          <Button
            onClick={() => {
              setForm({ ...BLANK, project: projects[0]?._id || "" });
              setFormError("");
              setRaising(true);
            }}
          >
            <Plus size={15} /> Request a change
          </Button>
        )}
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {!data ? (
        <Loader label="Loading requests…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Outstanding", value: data.counts.outstanding, tone: "text-amber-700" },
              { label: "Not started", value: data.counts.open },
              { label: "Being worked on", value: data.counts.inProgress, tone: "text-blue-700" },
              { label: "Completed", value: data.counts.completed, tone: "text-green-700" },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className={`mt-0.5 text-xl font-semibold ${s.tone || "text-slate-900"}`}>
                  {s.value ?? 0}
                </p>
              </Card>
            ))}
          </div>

          <Card>
            <div className="border-b border-slate-200 p-3">
              <Input
                placeholder="Search what was asked for"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>

            {data.items.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="Nothing here"
                message={
                  isClient
                    ? "Ask for a change and it appears here with whatever the team says about it."
                    : "No client has asked for a change on these projects."
                }
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {data.items.map((row) => (
                  <button
                    key={row._id}
                    type="button"
                    onClick={() => openRequest(row)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{row.title}</span>
                        <Badge value={prettify(row.status)} tone={STATUS_TONE[row.status]} />
                        <Badge value={row.priority} tone={PRIORITY_TONE[row.priority]} />
                      </div>

                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {row.project?.name || "—"}
                        {!isClient && row.client?.name ? ` · ${row.client.name}` : ""}
                        {row.assignedTo ? ` · with ${row.assignedTo.name}` : " · nobody on it yet"}
                      </p>

                      {row.status !== "rejected" && (
                        <div className="mt-2 max-w-xs">
                          <ProgressBar value={row.progress} />
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs text-slate-400">{when(row.createdAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.updates?.length || 0} update
                        {(row.updates?.length || 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ---------------------------------------------------- raise a change */}

      <Modal
        open={raising}
        title="Request a change"
        subtitle="The team is told as soon as you send it"
        onClose={() => setRaising(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRaising(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={raise} disabled={busy || !form.title.trim() || !form.project}>
              {busy ? "Sending…" : "Send it"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={raise}>
          {formError && <Alert>{formError}</Alert>}

          <Field label="Which project" required>
            <Select
              value={form.project}
              onChange={(e) => setForm((p) => ({ ...p, project: e.target.value }))}
              placeholder="Choose a project"
              options={projects.map((p) => ({ value: p._id, label: p.name }))}
              required
            />
          </Field>

          <Field label="What needs changing" required>
            <Input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Move the pricing section above the testimonials"
              required
            />
          </Field>

          <Field label="Any detail" hint="What the team needs to know before they start">
            <Textarea
              rows={3}
              value={form.detail}
              onChange={(e) => setForm((p) => ({ ...p, detail: e.target.value }))}
            />
          </Field>

          <Field label="How urgent">
            <Select
              value={form.priority}
              onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
              options={["low", "medium", "high"].map((v) => ({ value: v, label: prettify(v) }))}
            />
          </Field>
        </form>
      </Modal>

      {/* ------------------------------------------------------- one request */}

      <Modal
        open={Boolean(open)}
        title={open?.title || ""}
        subtitle={
          open
            ? `${open.project?.name || "Project"} · ${prettify(open.status)} · ${open.progress}%`
            : undefined
        }
        onClose={() => setOpen(null)}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setOpen(null)}>
            Close
          </Button>
        }
      >
        {open && (
          <div className="space-y-4">
            {open.detail && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{open.detail}</p>
            )}

            {open.status === "rejected" && open.closingNote && (
              <Alert>Declined — {open.closingNote}</Alert>
            )}

            {/* ------------------------------------------------ who has it */}
            {open.can?.assign && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
                <Field label="Who is doing it" className="flex-1">
                  <Select
                    value={open.assignedTo?._id || ""}
                    onChange={(e) => assign(e.target.value)}
                    placeholder="Choose somebody on the project"
                    options={people.map((p) => ({
                      value: p._id,
                      label: p.designation ? `${p.name} — ${p.designation}` : p.name,
                    }))}
                    disabled={busy}
                  />
                </Field>
                {!open.assignedTo && (
                  <p className="pb-2 text-xs text-amber-700">
                    <UserPlus size={12} className="mr-1 inline" />
                    Nobody has picked this up
                  </p>
                )}
              </div>
            )}

            {/* -------------------------------------------------- the thread */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                History
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {(open.updates || []).map((u) => (
                  <div
                    key={u._id}
                    className={`rounded-lg p-2.5 text-sm ${
                      u.authorRole === "client"
                        ? "bg-blue-50 text-slate-800"
                        : "bg-slate-50 text-slate-700"
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{u.authorName}</span>
                      <span>{when(u.at)}</span>
                      {u.status && <Badge value={prettify(u.status)} tone={STATUS_TONE[u.status]} />}
                      {u.progress !== undefined && u.progress !== null && (
                        <span className="text-slate-400">{u.progress}%</span>
                      )}
                    </p>
                    {u.note && <p className="mt-1">{u.note}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* ------------------------------------------------- say something */}
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <Field label={isClient ? "Add to your request" : "Report progress"}>
                <Textarea
                  rows={2}
                  value={reply.note}
                  onChange={(e) => setReply((p) => ({ ...p, note: e.target.value }))}
                  placeholder={
                    isClient ? "Anything else the team should know" : "What you have done"
                  }
                />
              </Field>

              {open.can?.progress && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="How far along" className="w-32">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={reply.progress}
                      onChange={(e) => setReply((p) => ({ ...p, progress: e.target.value }))}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => push({ progress: Number(reply.progress) || 0 })}
                  >
                    <Clock size={14} /> Save progress
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !reply.note.trim()}
                  onClick={() => push({})}
                >
                  <MessageSquare size={14} /> Post
                </Button>

                {open.can?.progress && open.status !== "completed" && (
                  <Button disabled={busy} onClick={() => push({ status: "completed" })}>
                    <CheckCircle2 size={14} /> Mark it done
                  </Button>
                )}

                {open.can?.decide && !["rejected", "completed"].includes(open.status) && (
                  <Button
                    variant="danger"
                    disabled={busy || !reply.note.trim()}
                    title={reply.note.trim() ? "" : "Give the client a reason first"}
                    onClick={() => push({ status: "rejected" })}
                  >
                    <XCircle size={14} /> Decline
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
