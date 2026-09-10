import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Reply,
  Send,
  Trash2,
} from "lucide-react";

import DataTable from "../components/DataTable";
import Modal, { ConfirmDialog } from "../components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loader,
  PageHeader,
  Textarea,
} from "../components/ui";

/**
 * The reporting chain, from whichever panel you are in.
 *
 *   Team Member  →  Manager  →  HR  →  Admin
 *
 * One screen for every level, because it is one journey and each level does
 * exactly the same three things: read what came up, answer it, and send its
 * own summary on. The only difference is what the server says you write and
 * who it goes to — which the page asks rather than assumes, so a person's
 * place in the hierarchy is never hard-coded into a screen.
 */

const KIND_LABEL = {
  member_update: "My update",
  team_update: "Team update",
  hr_report: "Company report",
};

const monthName = (month) =>
  [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month - 1] || "";

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const BLANK = { title: "", summary: "", highlights: "", blockers: "", sources: [] };

export default function ReportingPage({ api, basePath, title, subtitle }) {
  const [tab, setTab] = useState("inbox");

  const [context, setContext] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [outbox, setOutbox] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Writing
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Reading and answering
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState("");
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      api.get(`${basePath}/context`).then((r) => r.data),
      api.get(`${basePath}/inbox`).then((r) => r.data),
      api.get(`${basePath}/mine`).then((r) => r.data),
    ])
      .then(([ctx, box, mine]) => {
        if (!active) return;
        setContext(ctx);
        setInbox(box);
        setOutbox(mine);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load reports"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, reloadKey]);

  /**
   * What this person can roll up: everything sitting in their inbox for the
   * period they are writing about. A manager summarising their team names the
   * member updates they received, and the reader can then open them.
   */
  const rollupOptions = useMemo(
    () =>
      (inbox?.items || [])
        .filter((r) => r.year === context?.period?.year && r.month === context?.period?.month)
        .map((r) => ({ _id: r._id, label: `${r.authorName} — ${r.title}` })),
    [inbox, context]
  );

  const openCompose = () => {
    const existing = context?.existing;
    setForm(
      existing
        ? {
            title: existing.title || "",
            summary: existing.summary || "",
            highlights: (existing.highlights || []).join("\n"),
            blockers: (existing.blockers || []).join("\n"),
            sources: (existing.sources || []).map((s) => s._id || s),
          }
        : BLANK
    );
    setFormError("");
    setComposing(true);
  };

  const submit = async (asDraft) => {
    setSaving(true);
    setFormError("");

    try {
      const { data } = await api.post(basePath, {
        ...form,
        year: context.period.year,
        month: context.period.month,
        draft: asDraft,
        metrics: context.suggestedMetrics,
      });
      setComposing(false);
      setDone(data.message);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send that");
    } finally {
      setSaving(false);
    }
  };

  const act = async (id, what, note) => {
    setError("");
    try {
      const { data } = await api.put(`${basePath}/${id}/${what}`, { note });
      setOpen(null);
      setReply("");
      setDone(data.message);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not do that");
    }
  };

  const withdraw = async () => {
    setDeleting(true);
    try {
      await api.delete(`${basePath}/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not withdraw it");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !context) return <Loader label="Loading reports…" />;

  const inboxColumns = [
    {
      key: "author",
      header: "From",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.authorName}</p>
          <p className="text-xs text-slate-400">
            {(row.authorRole || "").replace(/_/g, " ")}
            {row.department ? ` · ${row.department}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "title",
      header: "Report",
      render: (row) => (
        <div>
          <p className="text-slate-900">{row.title}</p>
          <p className="text-xs text-slate-400">
            {monthName(row.month)} {row.year}
            {row.sources?.length ? ` · rolls up ${row.sources.length}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "blockers",
      header: "Blockers",
      render: (row) =>
        row.blockers?.length ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
            <AlertTriangle size={12} />
            {row.blockers.length}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    { key: "submittedAt", header: "Sent", render: (row) => shortDate(row.submittedAt) },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
  ];

  const outboxColumns = [
    {
      key: "title",
      header: "Report",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title}</p>
          <p className="text-xs text-slate-400">
            {KIND_LABEL[row.kind]} · {monthName(row.month)} {row.year}
          </p>
        </div>
      ),
    },
    { key: "submittedToName", header: "Sent to", render: (row) => row.submittedToName || "—" },
    { key: "submittedAt", header: "Sent", render: (row) => shortDate(row.submittedAt) },
    {
      key: "response",
      header: "Answer",
      render: (row) =>
        row.response?.note ? (
          <span className="line-clamp-2 max-w-[240px] text-slate-700">{row.response.note}</span>
        ) : (
          <span className="text-xs text-slate-400">
            {row.status === "reviewed" ? "Read, not answered" : "Waiting"}
          </span>
        ),
    },
    { key: "status", header: "", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        ["draft", "submitted"].includes(row.status) ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
            title="Withdraw"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          subtitle ||
          (context?.chain
            ? `${context.chain.from} → ${context.chain.to}`
            : "The reporting chain")
        }
      >
        <Button onClick={openCompose} disabled={context?.blocked}>
          <Send size={15} />
          {context?.existing ? "Edit this month's" : `Write ${KIND_LABEL[context?.kind] || "report"}`}
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{done}</Alert>

      {/* The chain, said plainly, so nobody has to guess where their report goes */}
      {context?.blocked ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {context.kind === "member_update"
            ? "You are not on a team yet, so there is nobody above you to report to. Ask your manager to add you."
            : "There is no HR account to send this to yet — an administrator has to create one."}
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="text-slate-500">Your reports go to</span>
          <Badge tone="blue">
            {context?.goesTo?.name}
            {context?.goesTo?.count > 1 ? ` (${context.goesTo.count})` : ""}
          </Badge>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">
            {monthName(context?.period?.month)} {context?.period?.year}
          </span>
          {context?.department && context.department !== "other" && (
            <>
              <span className="text-slate-400">·</span>
              <Badge tone="slate">{context.department}</Badge>
            </>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Waiting on you", inbox?.waiting ?? 0, inbox?.waiting > 0 ? "text-amber-600" : "text-slate-900"],
          ["Blockers raised", inbox?.blockers ?? 0, inbox?.blockers > 0 ? "text-red-600" : "text-slate-900"],
          ["Your reports answered", outbox?.answered ?? 0, "text-slate-900"],
        ].map(([label, value, colour]) => (
          <Card key={label}>
            <div className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className={`text-xl font-bold ${colour}`}>{value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex gap-1 border-b border-slate-100 px-4 pt-3">
          {[
            ["inbox", `Sent to you (${inbox?.total ?? 0})`],
            ["outbox", `Your reports (${outbox?.total ?? 0})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-t-lg px-3 py-2 text-sm transition-colors ${
                tab === key
                  ? "border-b-2 border-blue-600 font-medium text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <DataTable
          columns={tab === "inbox" ? inboxColumns : outboxColumns}
          rows={(tab === "inbox" ? inbox?.items : outbox?.items) || []}
          loading={loading}
          onRowClick={setOpen}
          emptyTitle={tab === "inbox" ? "Nothing sent up to you" : "You have not reported yet"}
          emptyMessage={
            tab === "inbox"
              ? "Reports from the people below you arrive here."
              : "Write one and it goes to the person above you."
          }
        />
      </Card>

      {/* ------------------------------------------------------- writing */}
      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title={`${KIND_LABEL[context?.kind] || "Report"} — ${monthName(context?.period?.month)} ${context?.period?.year}`}
        subtitle={context?.goesTo ? `Goes to ${context.goesTo.name}` : ""}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => submit(true)} loading={saving}>
              Save draft
            </Button>
            <Button onClick={() => submit(false)} loading={saving}>
              <Send size={15} />
              Send
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <Alert>{formError}</Alert>

          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={`${monthName(context?.period?.month)} — what happened`}
              required
            />
          </Field>

          <Field label="Summary">
            <Textarea
              rows={4}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="In your own words."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Highlights" hint="One per line">
              <Textarea
                rows={3}
                value={form.highlights}
                onChange={(e) => setForm({ ...form, highlights: e.target.value })}
              />
            </Field>
            <Field
              label="Blockers"
              hint="One per line — these are counted and escalated"
            >
              <Textarea
                rows={3}
                value={form.blockers}
                onChange={(e) => setForm({ ...form, blockers: e.target.value })}
              />
            </Field>
          </div>

          {/* What this report rolls up. Only offered where there is something
              in the inbox for the same month to roll up. */}
          {rollupOptions.length > 0 && (
            <Field
              label="Roll up these reports"
              hint="Whoever reads yours can open the ones you name"
            >
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {rollupOptions.map((option) => (
                  <label
                    key={option._id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={form.sources.includes(option._id)}
                      onChange={() =>
                        setForm({
                          ...form,
                          sources: form.sources.includes(option._id)
                            ? form.sources.filter((id) => id !== option._id)
                            : [...form.sources, option._id],
                        })
                      }
                      className="h-4 w-4 accent-blue-600"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {context?.suggestedMetrics && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200">
              Counted for you this month:{" "}
              {Object.entries(context.suggestedMetrics)
                .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()} ${value}`)
                .join(" · ")}
            </p>
          )}
        </form>
      </Modal>

      {/* ------------------------------------------------- reading one */}
      <Modal
        open={Boolean(open)}
        onClose={() => {
          setOpen(null);
          setReply("");
        }}
        title={open?.title || ""}
        subtitle={
          open
            ? `${open.authorName} · ${KIND_LABEL[open.kind]} · ${monthName(open.month)} ${open.year}`
            : ""
        }
        size="lg"
        footer={
          open && String(open.author?._id || open.author) !== String(outbox?.items?.[0]?.author) ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setOpen(null);
                  setReply("");
                }}
              >
                Close
              </Button>
              {open.status === "submitted" && (
                <Button variant="outline" onClick={() => act(open._id, "review", reply)}>
                  <Check size={15} />
                  Mark read
                </Button>
              )}
              <Button onClick={() => act(open._id, "respond", reply)} disabled={!reply.trim()}>
                <Reply size={15} />
                Answer
              </Button>
            </>
          ) : (
            <Button onClick={() => setOpen(null)}>Close</Button>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            {open.summary && <p className="text-sm text-slate-700">{open.summary}</p>}

            {open.highlights?.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Highlights
                </p>
                <ul className="list-inside list-disc text-sm text-slate-700">
                  {open.highlights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {open.blockers?.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-100">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  <AlertTriangle size={12} />
                  Blockers
                </p>
                <ul className="list-inside list-disc text-sm text-amber-900">
                  {open.blockers.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* What this report rolls up — the drill-down that makes a summary
                worth trusting rather than taking on faith */}
            {open.sources?.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <ArrowDown size={12} />
                  Rolls up {open.sources.length} report
                  {open.sources.length === 1 ? "" : "s"}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {open.sources.map((source) => (
                    <li key={source._id} className="px-3 py-2">
                      <p className="text-sm text-slate-800">{source.title}</p>
                      <p className="text-xs text-slate-400">
                        {source.authorName || source.author?.name} · {KIND_LABEL[source.kind]}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {open.review?.at && (
              <p className="text-xs text-slate-500">
                Read by {open.review.byName} on {shortDate(open.review.at)}
                {open.review.note ? ` — “${open.review.note}”` : ""}
              </p>
            )}

            {open.response?.at ? (
              <div className="rounded-lg bg-blue-50 p-3 ring-1 ring-inset ring-blue-100">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                  Answer from {open.response.byName}
                </p>
                <p className="text-sm text-blue-900">{open.response.note}</p>
              </div>
            ) : (
              <Field label="Your answer" hint="Sent back to whoever wrote this">
                <Textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="What you want them to do about it."
                />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Withdraw report"
        message={`Withdraw "${target?.title}"? It will be removed from the inbox above you.`}
        confirmLabel="Withdraw"
        loading={deleting}
        onConfirm={withdraw}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
