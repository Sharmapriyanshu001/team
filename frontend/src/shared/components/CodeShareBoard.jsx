import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileArchive,
  Inbox,
  Loader2,
  Send,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";

import Modal, { ConfirmDialog } from "./Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipList,
  EmptyState,
  Field,
  Input,
  Loader,
  MultiSelect,
  PageHeader,
  Textarea,
} from "./ui";

// Kept in step with MAX_UPLOAD_BYTES on the server
const MAX_UPLOAD_MB = 50;

const ROLE_LABELS = {
  admin: "Super Admin",
  operations_manager: "Operations Manager",
  employee: "Employee",
};

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const formatWhen = (value) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Saves a blob the browser fetched behind the panel's token. */
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * Sending code archives person to person. Identical in the admin, operations manager
 * and employee panels — each mounts it with its own api instance and base path,
 * and the server decides what that account may see.
 *
 * Two tabs: what I sent (and who has picked it up), and what was sent to me.
 */
export default function CodeShareBoard({ api, base, title = "Code", subtitle }) {
  const [tab, setTab] = useState("sent");

  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [sendOpen, setSendOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* --------------------------------------------------------------- loading */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sentRes, receivedRes] = await Promise.all([
        api.get(`${base}/code-share/sent`),
        api.get(`${base}/code-share/received`),
      ]);
      setSent(sentRes.data.items || []);
      setReceived(receivedRes.data.items || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the code section");
    } finally {
      setLoading(false);
    }
  }, [api, base]);

  useEffect(() => {
    load();
  }, [load]);

  // The people list never changes mid-session, so it is fetched once
  useEffect(() => {
    let active = true;
    api
      .get(`${base}/code-share/people`)
      .then(({ data }) => active && setPeople(data.people || []))
      .catch(() => active && setPeople([]));
    return () => {
      active = false;
    };
  }, [api, base]);

  /* -------------------------------------------------------------- actions */

  const download = async (row) => {
    setBusyId(row._id);
    try {
      const { data } = await api.get(`${base}/code-share/${row._id}/download`, {
        responseType: "blob",
      });
      saveBlob(data, row.originalName || `${row.title}.zip`);
      // The received list carries a "picked up" stamp that just changed
      if (tab === "received") load();
    } catch {
      setError("Could not download that archive");
    } finally {
      setBusyId("");
    }
  };

  const withdraw = async () => {
    setDeleting(true);
    try {
      const { data } = await api.delete(`${base}/code-share/${target._id}`);
      setSuccess(data.message || "Withdrawn");
      setTarget(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not withdraw it");
    } finally {
      setDeleting(false);
    }
  };

  const rows = tab === "sent" ? sent : received;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle || "Send a code archive to your team, and pick up what they send you"}
      >
        <Button onClick={() => setSendOpen(true)}>
          <SendHorizontal size={15} />
          Send code
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {/* the two buttons the section opens on */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "sent", label: "Sent", icon: Send, count: sent.length },
          { key: "received", label: "Received", icon: Inbox, count: received.length },
        ].map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon size={15} />
              {entry.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {entry.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <Card>
          <Loader label="Loading your code…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={tab === "sent" ? Send : Inbox}
            title={tab === "sent" ? "You have not sent anything yet" : "Nothing has been sent to you"}
            message={
              tab === "sent"
                ? "Use “Send code” above to pick people and attach a ZIP."
                : "Archives your colleagues send you will show up here."
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row._id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FileArchive size={18} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{row.title}</p>
                  <p className="truncate text-xs text-slate-400">
                    {row.originalName} · {formatSize(row.size)} ·{" "}
                    {tab === "sent" ? "sent" : `from ${row.sentByName}`} {formatWhen(row.createdAt)}
                  </p>
                  {row.note && <p className="mt-1.5 text-sm text-slate-600">{row.note}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === row._id}
                    onClick={() => download(row)}
                  >
                    <Download size={13} />
                    Download
                  </Button>
                  {tab === "sent" && (
                    <Button size="sm" variant="danger" onClick={() => setTarget(row)}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </div>

              {/* the history line: who it went to, and who has taken it */}
              {tab === "sent" ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users size={13} />
                    Sent to {row.recipientCount}{" "}
                    {row.recipientCount === 1 ? "person" : "people"} · {row.downloadedCount}{" "}
                    downloaded
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {row.recipients.map((person) => (
                      <span
                        key={person.user}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                          person.downloadedAt
                            ? "bg-blue-50 text-blue-700 ring-blue-200"
                            : "bg-slate-50 text-slate-600 ring-slate-200"
                        }`}
                        title={
                          person.downloadedAt
                            ? `Downloaded ${formatWhen(person.downloadedAt)}`
                            : "Not downloaded yet"
                        }
                      >
                        {person.name}
                        <span className="text-[10px] opacity-70">
                          {ROLE_LABELS[person.role] || person.role}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <Badge tone={row.myDownloadedAt ? "black" : "sky"}>
                    {row.myDownloadedAt
                      ? `Downloaded ${formatWhen(row.myDownloadedAt)}`
                      : "Not downloaded yet"}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    from {row.sentByName} · {ROLE_LABELS[row.sentByRole] || row.sentByRole}
                  </span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <SendCodeModal
        open={sendOpen}
        api={api}
        base={base}
        people={people}
        onClose={() => setSendOpen(false)}
        onSent={(message) => {
          setSuccess(message);
          setTab("sent");
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Withdraw this code"
        message={`Remove "${target?.title}"? It disappears for all ${target?.recipientCount} ${
          target?.recipientCount === 1 ? "person" : "people"
        } you sent it to, and the archive is deleted.`}
        confirmLabel="Withdraw"
        loading={deleting}
        onConfirm={withdraw}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------ send modal */

function SendCodeModal({ open, api, base, people, onClose, onSent }) {
  const fileInput = useRef(null);

  const [recipients, setRecipients] = useState([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [form, setForm] = useState({ title: "", note: "" });
  const [zip, setZip] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const options = people.map((person) => ({
    value: person._id,
    label: person.designation ? `${person.name} — ${person.designation}` : person.name,
    role: person.role,
    group: ROLE_LABELS[person.role] || person.role,
  }));

  const visible = roleFilter ? options.filter((o) => o.role === roleFilter) : options;
  const picked = options.filter((o) => recipients.includes(o.value));

  const pickZip = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.zip$/i.test(file.name)) {
      setError("Only a .zip file can be sent");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`That ZIP is over the ${MAX_UPLOAD_MB} MB limit`);
      e.target.value = "";
      return;
    }

    setError("");
    setZip(file);
    // An untouched title follows the file, which is what people expect
    setForm((prev) => ({ ...prev, title: prev.title || file.name.replace(/\.zip$/i, "") }));
  };

  const clearZip = () => {
    setZip(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const close = () => {
    setRecipients([]);
    setRoleFilter("");
    setForm({ title: "", note: "" });
    clearZip();
    setError("");
    onClose();
  };

  const handleSend = async (e) => {
    e?.preventDefault();

    if (!recipients.length) {
      setError("Pick at least one person to send this to");
      return;
    }
    if (!zip) {
      setError("Attach the .zip you want to send");
      return;
    }

    setSending(true);
    setError("");

    try {
      const body = new FormData();
      body.append("file", zip);
      body.append("title", form.title.trim());
      body.append("note", form.note.trim());
      body.append("recipients", JSON.stringify(recipients));

      const { data } = await api.post(`${base}/code-share`, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onSent?.(data.message || "Sent");
      close();
    } catch (err) {
      setError(err.response?.data?.message || "Could not send the code");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Send code"
      subtitle="Pick as many people as you like and send them one ZIP"
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button loading={sending} onClick={handleSend}>
            {sending ? "Sending…" : recipients.length > 1 ? `Send to ${recipients.length}` : "Send"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSend} className="space-y-4">
        <Alert>{error}</Alert>

        {/* who gets it */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Send to
          </h4>

          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { value: "", label: "Everyone" },
              { value: "admin", label: "Super Admin" },
              { value: "operations_manager", label: "Operations Managers" },
              { value: "employee", label: "Employees" },
            ].map((role) => (
              <button
                key={role.value || "all"}
                type="button"
                onClick={() => setRoleFilter(role.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  roleFilter === role.value
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>

          <Field
            required
            hint={
              options.length
                ? "Tick as many as you like — the buttons above only filter the list"
                : "No colleagues on record yet"
            }
          >
            <MultiSelect
              options={visible}
              value={recipients}
              onChange={setRecipients}
              placeholder="Search by name…"
              emptyLabel="No colleagues on record yet"
            />
          </Field>

          <div className="mt-2">
            <ChipList
              items={picked}
              onRemove={(id) => setRecipients((prev) => prev.filter((v) => v !== id))}
              empty="Nobody picked yet."
            />
          </div>
        </section>

        {/* the archive */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            The ZIP
          </h4>

          {zip ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{zip.name}</p>
                <p className="text-xs text-slate-500">{formatSize(zip.size)}</p>
              </div>
              <button
                type="button"
                onClick={clearZip}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                aria-label="Remove the attached ZIP"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 transition-colors hover:border-blue-500 hover:bg-blue-50/40">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">
                <FileArchive size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">Choose a ZIP file</span>
                <span className="block text-xs text-slate-500">
                  Only .zip · up to {MAX_UPLOAD_MB} MB
                </span>
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={pickZip}
                className="hidden"
              />
            </label>
          )}
        </section>

        {/* what it is */}
        <section className="space-y-4">
          <Field label="Title" hint="Defaults to the file name">
            <Input
              name="title"
              value={form.title}
              onChange={change}
              placeholder="Login module — v2"
            />
          </Field>

          <Field label="Note">
            <Textarea
              name="note"
              value={form.note}
              onChange={change}
              placeholder="What is in the archive, and what you want done with it"
            />
          </Field>
        </section>

        {sending && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin text-blue-600" />
            Uploading {zip?.name} — keep this window open.
          </p>
        )}
      </form>
    </Modal>
  );
}
