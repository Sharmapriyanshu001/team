import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileText,
  Inbox,
  Pencil,
  Reply,
  Search,
  Send,
  Trash2,
  Users,
} from "lucide-react";

import Modal, { ConfirmDialog } from "../components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loader,
  Select,
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

/**
 * The four states, said the way a person would say them.
 *
 * The stored words are the database's ("submitted", "responded"); these are
 * what the reader is actually asking — has anybody looked at it, and did they
 * answer. A report sitting in "submitted" for a fortnight is the complaint
 * this whole chain exists to surface, so it is labelled "Waiting" rather than
 * with a word that sounds like it is finished.
 */
const STATUS_LABEL = {
  draft: "Draft",
  submitted: "Waiting",
  reviewed: "Read",
  responded: "Answered",
};

const STATUS_TONE = {
  draft: "slate",
  submitted: "sky",
  reviewed: "blue",
  responded: "black",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const monthName = (month) => MONTHS[month - 1] || "";

const monthOptions = MONTHS.map((label, index) => ({ value: index + 1, label }));

const yearOptions = (() => {
  const year = new Date().getFullYear();
  return [year, year - 1, year - 2].map((value) => ({ value, label: String(value) }));
})();

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const initials = (name) =>
  String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

const TODAY = new Date();
const THIS_PERIOD = { year: TODAY.getFullYear(), month: TODAY.getMonth() + 1 };

const BLANK = {
  title: "",
  summary: "",
  highlights: "",
  blockers: "",
  sources: [],
  /**
   * Which of the offered destinations this goes to. A key, never an id — the
   * server resolves who the key means, so the form cannot address a report to
   * somebody who is not above the author. Blank means "the first one", which
   * is the ordinary step up the chain.
   */
  recipient: "",
  ...THIS_PERIOD,
};

/* ------------------------------------------------------------------ pieces */

/** One figure, with the icon that says which half of the screen it counts. */
function Stat({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-500",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    blue: "bg-blue-50 text-blue-600",
  };

  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-3 p-3.5">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="text-lg font-bold leading-tight text-slate-900">{value}</p>
        </div>
      </div>
    </Card>
  );
}

/**
 * One report in a list.
 *
 * A card rather than a table row, and deliberately: a report is a paragraph of
 * writing with two or three facts attached, and what a reader wants first is
 * the sentence — not the fourth column. On somebody's own report the answer
 * that came back is the whole point, so it is on the row rather than one click
 * inside it.
 */
function ReportRow({ report, mine, onOpen, onWithdraw }) {
  const blockers = report.blockers?.length || 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(report)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(report)}
      className="group flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          mine ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-700"
        }`}
      >
        {mine ? <FileText size={15} /> : initials(report.authorName)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 truncate text-sm font-medium text-slate-900">{report.title}</p>
          <Badge tone={STATUS_TONE[report.status]}>
            {STATUS_LABEL[report.status] || report.status}
          </Badge>
          {blockers > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              <AlertTriangle size={11} />
              {blockers} blocker{blockers === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-xs text-slate-500">
          {mine
            ? `To ${report.submittedToName || "—"}`
            : `${report.authorName} · ${(report.authorRole || "").replace(/_/g, " ")}`}
          {" · "}
          {monthName(report.month)} {report.year}
          {report.submittedAt ? ` · sent ${shortDate(report.submittedAt)}` : ""}
          {report.sources?.length ? ` · rolls up ${report.sources.length}` : ""}
        </p>

        {mine && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-600">
            {report.response?.note ? (
              <>
                <Reply size={11} className="mr-1 inline align-[-1px] text-blue-600" />
                {report.response.note}
              </>
            ) : report.status === "reviewed" ? (
              <span className="text-slate-400">Read, but not answered yet</span>
            ) : report.status === "draft" ? (
              <span className="text-slate-400">Not sent — open it to finish</span>
            ) : (
              <span className="text-slate-400">Waiting on an answer</span>
            )}
          </p>
        )}
      </div>

      <span className="flex shrink-0 items-center gap-1 self-center">
        {mine && ["draft", "submitted"].includes(report.status) && (
          <button
            type="button"
            title="Withdraw"
            onClick={(e) => {
              e.stopPropagation();
              onWithdraw(report);
            }}
            className="rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        )}
        <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500" />
      </span>
    </div>
  );
}

/** Sent → read → answered, with the dates, so nothing has to be inferred. */
function Trail({ report }) {
  const steps = [
    { label: "Sent", at: report.submittedAt, icon: Send },
    { label: "Read", at: report.review?.at, icon: Check },
    { label: "Answered", at: report.response?.at, icon: CheckCheck },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-2">
          {index > 0 && <ArrowRight size={12} className="text-slate-300" />}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
              step.at
                ? "bg-blue-50 text-blue-700 ring-blue-200"
                : "bg-slate-50 text-slate-400 ring-slate-200"
            }`}
          >
            <step.icon size={11} />
            {step.label}
            {step.at ? ` · ${shortDate(step.at)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- the screen */

export default function ReportingPage({ api, basePath, title, subtitle }) {
  const [tab, setTab] = useState("inbox");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  /**
   * The month being written about — not a filter on the lists.
   *
   * Somebody filing late needs to write last month's update, and a screen that
   * can only ever write today's forces them to file it under the wrong month
   * and explain in the title. The lists stay whole, because "what did I send
   * and did anybody answer" is never a question about one month.
   */
  const [period, setPeriod] = useState(THIS_PERIOD);

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
      api.get(`${basePath}/context`, { params: period }).then((r) => r.data),
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
  }, [api, basePath, period, reloadKey]);

  // A confirmation that stays on screen is read once and then becomes furniture
  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => setDone(""), 5000);
    return () => clearTimeout(timer);
  }, [done]);

  /**
   * A team member has nobody underneath them, so an inbox tab is a promise the
   * screen cannot keep — an empty box that will never fill, sitting in front of
   * the half of the screen they came for. It appears the moment somebody does
   * report to them.
   */
  const hasInbox = Boolean(inbox?.total) || (context ? context.kind !== "member_update" : true);

  // Derived rather than corrected in an effect, so the list never renders once
  // against a tab that is not on screen
  const activeTab = hasInbox ? tab : "outbox";

  /**
   * What this person can roll up: everything sitting in their inbox for the
   * period they are writing about. A manager summarising their team names the
   * member updates they received, and the reader can then open them.
   */
  const rollupOptions = useMemo(
    () =>
      (inbox?.items || [])
        .filter((r) => r.year === form.year && r.month === form.month)
        .map((r) => ({ _id: r._id, label: `${r.authorName} — ${r.title}` })),
    [inbox, form.year, form.month]
  );

  const rows = useMemo(() => {
    const list = (activeTab === "inbox" ? inbox?.items : outbox?.items) || [];
    const needle = query.trim().toLowerCase();

    return list.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (!needle) return true;
      return [report.title, report.summary, report.authorName, report.submittedToName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [activeTab, inbox, outbox, query, statusFilter]);

  /**
   * Opening the composer on an existing report rather than only on this
   * month's. A draft that can only be reopened while the calendar still says
   * the same month is a draft somebody loses.
   */
  const openCompose = useCallback(
    (report) => {
      const existing = report || context?.existing;
      setForm(
        existing
          ? {
              title: existing.title || "",
              summary: existing.summary || "",
              highlights: (existing.highlights || []).join("\n"),
              blockers: (existing.blockers || []).join("\n"),
              sources: (existing.sources || []).map((s) => s._id || s),
              // Where the draft was already headed, matched back to a choice
              recipient:
                context?.recipients?.find((o) => o.name === existing.submittedToName)?.key ||
                context?.recipients?.[0]?.key ||
                "",
              year: existing.year || period.year,
              month: existing.month || period.month,
            }
          : {
              ...BLANK,
              recipient: context?.recipients?.[0]?.key || "",
              year: period.year,
              month: period.month,
            }
      );
      setFormError("");
      setComposing(true);
    },
    [context, period]
  );

  /**
   * The list row is enough to show something immediately; the detail call
   * fills in the reports underneath a summary, which the list does not carry.
   *
   * `mine` is passed in rather than guessed. The outbox is by definition what
   * this person wrote and the inbox is by definition what they did not, and
   * inferring it from the data instead is how a reply box ends up on somebody's
   * own report.
   */
  const openReport = useCallback(
    async (report, mine) => {
      if (mine && report.status === "draft") {
        openCompose(report);
        return;
      }

      setOpen({ ...report, mine });
      setReply("");

      try {
        const { data } = await api.get(`${basePath}/${report._id}`);
        setOpen((current) =>
          current && current._id === report._id ? { ...current, ...data.item, mine } : current
        );
      } catch {
        // The row already on screen is a readable report on its own
      }
    },
    [api, basePath, openCompose]
  );

  const submit = async (asDraft) => {
    setSaving(true);
    setFormError("");

    try {
      const { data } = await api.post(basePath, {
        ...form,
        // Blank means the default, which the server reads as the first option
        recipient: form.recipient || context?.recipients?.[0]?.key || "",
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
      setDone("Withdrawn");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not withdraw it");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !context) return <Loader label="Loading reports…" />;

  const writingLabel = KIND_LABEL[context?.kind] || "report";
  const mineTab = activeTab === "outbox";

  const stats = [
    ...(hasInbox
      ? [
          {
            icon: Clock3,
            label: "Waiting on you",
            value: inbox?.waiting ?? 0,
            tone: inbox?.waiting > 0 ? "amber" : "slate",
          },
          {
            icon: AlertTriangle,
            label: "Blockers raised",
            value: inbox?.blockers ?? 0,
            tone: inbox?.blockers > 0 ? "red" : "slate",
          },
        ]
      : []),
    {
      icon: Send,
      label: "Awaiting an answer",
      value: outbox?.awaitingAnswer ?? 0,
      tone: outbox?.awaitingAnswer > 0 ? "blue" : "slate",
    },
    { icon: CheckCheck, label: "Answered", value: outbox?.answered ?? 0 },
  ];

  const tabs = [
    ...(hasInbox
      ? [{ key: "inbox", label: "Sent to you", count: inbox?.total ?? 0, icon: Inbox }]
      : []),
    { key: "outbox", label: "Your reports", count: outbox?.total ?? 0, icon: FileText },
  ];

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {subtitle ||
              (context?.chain
                ? `${context.chain.from} → ${context.chain.to}`
                : "The reporting chain")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Which month is being written about. The lists are unaffected. */}
          <div className="flex items-center gap-1.5">
            <CalendarDays size={15} className="shrink-0 text-slate-400" />
            <Select
              className="w-32"
              title="The month this report is about"
              value={period.month}
              onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
              options={monthOptions}
            />
            <Select
              className="w-24"
              value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
              options={yearOptions}
            />
          </div>

          <Button onClick={() => openCompose()} disabled={context?.blocked}>
            {context?.existing ? <Pencil size={15} /> : <Send size={15} />}
            {context?.existing ? "Edit this report" : `Write ${writingLabel.toLowerCase()}`}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      <Alert tone="success">{done}</Alert>

      {/* --------------------------- the chain, so nobody has to guess it */}
      {context?.blocked ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex items-start gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0">
              {/**
               * This used to appear for anybody not on a team, which meant
               * the people with least around them were the ones told they
               * could not speak. Being on no team is no longer a reason —
               * this is now only the empty company, with nobody at all to
               * send anything to.
               */}
              <p className="text-sm font-semibold text-amber-900">
                There is nobody set up to receive reports yet
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                An administrator has to set up the people above you before a report has
                anywhere to go. Nothing you write would reach anyone yet.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              <FileText size={12} />
              {writingLabel}
            </span>
            <ArrowRight size={14} className="text-slate-300" />
            {/**
             * Every destination that is open, not only the default. A member
             * can send their update to the person above them or to HR, and a
             * strip naming one of them would be telling them the other is not
             * allowed.
             */}
            {(context?.recipients?.length
              ? context.recipients
              : [{ key: "none", name: context?.goesTo?.name || "—", count: 0 }]
            ).map((option, index) => (
              <span key={option.key} className="inline-flex items-center gap-1.5">
                {index > 0 && <span className="text-xs text-slate-400">or</span>}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                  <Users size={12} />
                  {option.name}
                  {option.count > 1 ? ` (${option.count})` : ""}
                </span>
              </span>
            ))}

            <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>
                Writing for {monthName(period.month)} {period.year}
              </span>
              {context?.existing && (
                <Badge tone={STATUS_TONE[context.existing.status]}>
                  {STATUS_LABEL[context.existing.status]}
                </Badge>
              )}
              {context?.department && context.department !== "other" && (
                <Badge tone="slate">{context.department}</Badge>
              )}
            </span>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- figures */}
      <div className={`grid gap-3 sm:grid-cols-2 ${stats.length > 2 ? "xl:grid-cols-4" : ""}`}>
        {stats.map((stat) => (
          <Stat key={stat.label} {...stat} />
        ))}
      </div>

      {/* ------------------------------------------------------------- list */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {tabs.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === item.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <item.icon size={13} />
                {item.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    activeTab === item.key
                      ? "bg-blue-50 text-blue-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reports"
                className="w-48 pl-8"
              />
            </div>
            <Select
              className="w-36"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: "Any status" },
                ...(mineTab ? [{ value: "draft", label: "Draft" }] : []),
                { value: "submitted", label: "Waiting" },
                { value: "reviewed", label: "Read" },
                { value: "responded", label: "Answered" },
              ]}
            />
          </div>
        </div>

        {loading ? (
          <Loader />
        ) : rows.length ? (
          <div className="divide-y divide-slate-100">
            {rows.map((report) => (
              <ReportRow
                key={report._id}
                report={report}
                mine={mineTab}
                onOpen={(row) => openReport(row, mineTab)}
                onWithdraw={setTarget}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={mineTab ? FileText : Inbox}
            title={
              query || statusFilter !== "all"
                ? "Nothing matches that"
                : mineTab
                  ? "You have not reported yet"
                  : "Nothing sent up to you"
            }
            message={
              query || statusFilter !== "all"
                ? "Clear the search or the status filter to see everything."
                : mineTab
                  ? context?.blocked
                    ? "Nobody is set up to receive reports yet."
                    : context?.recipients?.length > 1
                      ? `Write one and send it to ${context.recipients
                          .map((o) => o.name)
                          .join(" or ")}.`
                      : `Write one and it goes to ${
                          context?.recipients?.[0]?.name || "the person above you"
                        }.`
                  : "Reports from the people below you arrive here."
            }
            action={
              mineTab && !context?.blocked && !query && statusFilter === "all" ? (
                <Button className="mt-2" onClick={() => openCompose()}>
                  <Send size={15} />
                  Write {writingLabel.toLowerCase()}
                </Button>
              ) : null
            }
          />
        )}
      </Card>

      {/* ------------------------------------------------------- writing */}
      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title={`${writingLabel} — ${monthName(form.month)} ${form.year}`}
        subtitle={
          context?.recipients?.length
            ? `Goes to ${
                (
                  context.recipients.find((o) => o.key === form.recipient) ||
                  context.recipients[0]
                ).name
              }`
            : ""
        }
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => submit(true)} loading={saving}>
              Save draft
            </Button>
            <Button onClick={() => submit(false)} loading={saving} disabled={!form.title.trim()}>
              <Send size={15} />
              Send
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <Alert>{formError}</Alert>

          {/**
           * Who it goes to, when there is a choice.
           *
           * An update about being blocked on the person above you has nowhere
           * to go if they are the only address. Only rendered when the server
           * offers more than one — a manager's step up the chain is not a
           * matter of opinion, and a select with one option is furniture.
           */}
          {context?.recipients?.length > 1 && (
            <Field label="Send to" required>
              <Select
                value={form.recipient || context.recipients[0].key}
                onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                options={context.recipients.map((option) => ({
                  value: option.key,
                  label:
                    option.name === option.label
                      ? option.label
                      : `${option.label} — ${option.name}`,
                }))}
              />
            </Field>
          )}

          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={`${monthName(form.month)} — what happened`}
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
            <Field label="Blockers" hint="One per line — these are counted and escalated">
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
            ? `${open.mine ? `To ${open.submittedToName || "—"}` : open.authorName} · ${
                KIND_LABEL[open.kind]
              } · ${monthName(open.month)} ${open.year}`
            : ""
        }
        size="lg"
        footer={
          open && !open.mine ? (
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
            <Trail report={open} />

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

            {open.review?.note && (
              <p className="text-xs text-slate-500">
                Read by {open.review.byName} on {shortDate(open.review.at)} — “{open.review.note}”
              </p>
            )}

            {open.response?.at ? (
              <div className="rounded-lg bg-blue-50 p-3 ring-1 ring-inset ring-blue-100">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                  Answer from {open.response.byName}
                </p>
                <p className="text-sm text-blue-900">{open.response.note}</p>
              </div>
            ) : open.mine ? (
              /* Your own report gets the state of play, not a box to reply to
                 yourself in */
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                {open.status === "reviewed"
                  ? `${open.review?.byName || "They"} have read this but not answered it yet.`
                  : `Waiting on ${open.submittedToName || "the person above you"} to read it.`}
              </p>
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
