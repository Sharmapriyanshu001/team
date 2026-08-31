import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, History, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";

import useLookups from "../../hooks/useLookups";
import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loader,
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import { CREDENTIAL_TYPES } from "../crm/constants";

const BLANK = {
  label: "",
  type: "other",
  client: "",
  url: "",
  username: "",
  secret: "",
  notes: "",
  hint: "",
  sharedWith: [],
  expiresAt: "",
  status: "active",
};

const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * The credential vault.
 *
 * The screen is built around one fact: the secret is not here. The list shows
 * only that an entry has one, and getting it takes a deliberate click that the
 * server writes down. That is why there is no "show all" and why the reveal
 * dialog closes rather than staying open — a password left on screen behind
 * somebody's back is the failure this whole feature exists to prevent.
 */
export default function Vault() {
  const lookups = useLookups();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [revealed, setRevealed] = useState(null);
  const [revealError, setRevealError] = useState("");
  const [copied, setCopied] = useState("");

  const [historyFor, setHistoryFor] = useState(null);
  const [target, setTarget] = useState(null);

  const load = useCallback(() => {
    adminApi
      .get("/admin/vault", { params: { search, type: typeFilter || undefined, limit: 200 } })
      .then(({ data }) => {
        setRows(data.items || []);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not open the vault"))
      .finally(() => setLoading(false));
  }, [search, typeFilter]);

  useEffect(load, [load]);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || "",
            // Always blank: the form cannot show what it never received
            secret: "",
            notes: "",
            sharedWith: (row.sharedWith || []).map((u) => u._id || u),
            expiresAt: row.expiresAt ? row.expiresAt.slice(0, 10) : "",
          }
        : BLANK
    );
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, client: form.client || null, expiresAt: form.expiresAt || null };
      if (editing?._id) await adminApi.put(`/admin/vault/${editing._id}`, payload);
      else await adminApi.post("/admin/vault", payload);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this entry");
    } finally {
      setSaving(false);
    }
  };

  const reveal = async (row) => {
    setRevealError("");
    setCopied("");
    try {
      const { data } = await adminApi.post(`/admin/vault/${row._id}/reveal`, {});
      setRevealed({ ...data, _id: row._id, username: row.username, url: row.url });
      load();
    } catch (err) {
      setRevealError(err.response?.data?.message || "Could not reveal this secret");
      setRevealed({ _id: row._id, label: row.label, secret: "", notes: "" });
    }
  };

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  const showHistory = async (row) => {
    try {
      const { data } = await adminApi.get(`/admin/vault/${row._id}/access-log`);
      setHistoryFor(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the access log");
    }
  };

  if (loading) return <Loader label="Opening the vault…" />;

  const vaultOff = error.includes("VAULT_KEY");

  return (
    <div>
      <PageHeader
        title="Vault"
        subtitle="Logins for consoles, hosting and everything else — encrypted, and every look recorded"
      >
        <Button onClick={() => open(null)} disabled={vaultOff}>
          <Plus size={15} />
          Add credential
        </Button>
      </PageHeader>

      {vaultOff ? (
        <Card>
          <div className="flex items-start gap-3 p-6">
            <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p className="font-medium text-slate-900">The vault is switched off</p>
              <p className="mt-1 text-slate-600">{error}</p>
              <p className="mt-3 text-xs text-slate-500">
                Generate a key and put it in <code className="font-mono">backend/.env</code> as{" "}
                <code className="font-mono">VAULT_KEY</code>, then restart the server. Nothing is
                ever stored unencrypted, so until then the vault simply refuses to work.
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-[11px] text-slate-100">
                node -e
                &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64url&apos;))&quot;
              </pre>
              <p className="mt-3 text-xs text-amber-700">
                Back that key up somewhere that is not this server. Lose it and every secret in the
                vault is unrecoverable — by design.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Alert>{error}</Alert>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, username or URL"
                className="min-w-[200px] flex-1"
              />
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={CREDENTIAL_TYPES}
                placeholder="Any kind"
                className="w-auto min-w-[150px]"
              />
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <KeyRound size={28} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">Nothing in the vault yet</p>
                <p className="mt-1 text-sm text-slate-400">
                  Put the Play console, cPanel and hosting logins here instead of a spreadsheet.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-medium text-slate-900">{row.label}</p>
                      <p className="text-xs text-slate-400">
                        {row.username || "no username"}
                        {row.client?.name && ` · ${row.client.name}`}
                        {row.hint && ` · ${row.hint}`}
                      </p>
                    </div>

                    <Badge value={row.type} />

                    {row.sharedWith?.length > 0 && (
                      <span className="text-xs text-slate-500">
                        shared with {row.sharedWith.length}
                      </span>
                    )}

                    <span className="text-xs text-slate-400">
                      {row.lastAccess
                        ? `last opened by ${row.lastAccess.userName || "someone"}`
                        : "never opened"}
                    </span>

                    <div className="ml-auto flex gap-1">
                      <button
                        onClick={() => reveal(row)}
                        disabled={!row.hasSecret}
                        title={row.hasSecret ? "Reveal the secret" : "Nothing stored"}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => showHistory(row)}
                        title="Who has looked"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <History size={15} />
                      </button>
                      <button
                        onClick={() => open(row)}
                        title="Edit"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setTarget(row)}
                        title="Delete"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* -------------------------------------------------------- add / edit */}
      <Modal
        open={Boolean(editing)}
        title={editing?._id ? editing.label : "Add a credential"}
        subtitle={
          editing?._id
            ? "Leave the secret blank to keep the one already stored"
            : "The secret is encrypted before it is written down"
        }
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.label.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Acme cPanel"
            />
          </Field>
          <Field label="Kind">
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              options={CREDENTIAL_TYPES}
            />
          </Field>
          <Field label="Client">
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Ours"
            />
          </Field>
          <Field label="URL">
            <Input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
            />
          </Field>
          <Field label="Username">
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </Field>
          <Field
            label={editing?._id && editing.hasSecret ? "New password" : "Password"}
            hint={
              editing?._id && editing.hasSecret
                ? "Blank leaves the current one alone"
                : "Encrypted with AES-256-GCM before it is stored"
            }
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
            />
          </Field>
          <Field label="Expires on" hint="For API keys and registrar logins that do">
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
            />
          </Field>
          <Field label="Hint" hint="Shown in the list, in the clear — a note to a colleague">
            <Input
              value={form.hint}
              onChange={(e) => setForm((f) => ({ ...f, hint: e.target.value }))}
              placeholder="e.g. 2FA on Abhay's phone"
            />
          </Field>
          <Field
            label="Recovery codes / notes"
            hint="Encrypted too. Blank leaves what is already there."
            className="sm:col-span-2"
          >
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <Field
            label="Who may open it"
            hint="Admins always can. Anyone named here can reveal it from their own panel."
            className="sm:col-span-2"
          >
            <MultiSelect
              options={lookups.staffOptions}
              value={form.sharedWith}
              onChange={(value) => setForm((f) => ({ ...f, sharedWith: value }))}
              placeholder="Search staff…"
              emptyLabel="Nobody on record"
            />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------------------------------------ reveal */}
      <Modal
        open={Boolean(revealed)}
        title={revealed?.label}
        subtitle="This has been written to the access log"
        size="sm"
        onClose={() => {
          setRevealed(null);
          setCopied("");
        }}
        footer={
          <Button
            onClick={() => {
              setRevealed(null);
              setCopied("");
            }}
          >
            Done
          </Button>
        }
      >
        <Alert>{revealError}</Alert>

        {revealed?.secret && (
          <div className="space-y-3">
            {revealed.username && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-700">Username</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">
                    {revealed.username}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(revealed.username, "username")}
                  >
                    <Copy size={13} />
                    {copied === "username" ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Password</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">
                  {revealed.secret}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(revealed.secret, "secret")}>
                  <Copy size={13} />
                  {copied === "secret" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            {revealed.notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-700">Notes</p>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs">
                  {revealed.notes}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------- access log */}
      <Modal
        open={Boolean(historyFor)}
        title={`Who has opened ${historyFor?.label || "this"}`}
        subtitle="Most recent first"
        size="sm"
        onClose={() => setHistoryFor(null)}
      >
        {historyFor?.accessLog?.length ? (
          <div className="divide-y divide-slate-100">
            {historyFor.accessLog.map((entry, index) => (
              <div key={index} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 text-slate-700">{entry.userName || "Someone"}</span>
                <Badge value={entry.action} />
                <span className="text-xs text-slate-400">{when(entry.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">Nobody has opened this yet.</p>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this credential?"
        message={`"${target?.label}" and its access history will be removed. If the login still works somewhere, deleting the record does not change that — rotate it instead.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await adminApi.delete(`/admin/vault/${target._id}`);
          setTarget(null);
          load();
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
