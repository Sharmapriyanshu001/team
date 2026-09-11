import { useCallback, useEffect, useState } from "react";
import {
  ClipboardList,
  MessageSquarePlus,
  PhoneCall,
  Plus,
  UserCheck,
} from "lucide-react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";
import { LEAD_SOURCES, LEAD_STAGES, STAGE_TONE, money, shortDate } from "../constants";

/**
 * Leads — which in this app are also the deals.
 *
 * The list is the finding tool; the drawer is where the work happens. Opening
 * a lead has to show, in one place, everything somebody needs before they pick
 * up the phone: what was said last time, what was promised, and what they
 * asked for. Anything less and the call starts with an apology.
 *
 * An executive only ever sees their own rows here — enforced by the server on
 * every request, not by this page. The owner column appears for a head because
 * it is the one thing a head reads the list for.
 */

const BLANK = {
  name: "",
  company: "",
  email: "",
  phone: "",
  city: "",
  source: "other",
  sourceDetail: "",
  requirement: "",
  estimatedValue: "",
  followUpOn: "",
};

export default function Leads() {
  const { isSalesHead, can } = useSalesAccess();

  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("open");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  /** The open lead, with its whole history. */
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    salesApi
      .get("/sales/leads", {
        params: {
          search: search || undefined,
          stage: stage || undefined,
          source: source || undefined,
          owner: owner || undefined,
        },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load leads"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, stage, source, owner, reloadKey]);

  useEffect(() => {
    salesApi
      .get("/sales/people")
      .then(({ data }) => setPeople(data.items || []))
      .catch(() => setPeople([]));
  }, []);

  const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const openLead = async (row) => {
    setDetailBusy(true);
    try {
      const { data } = await salesApi.get(`/sales/leads/${row._id}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that lead");
    } finally {
      setDetailBusy(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail?.item?._id) return;
    const { data } = await salesApi.get(`/sales/leads/${detail.item._id}`);
    setDetail(data);
    reload();
  };

  const createLead = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const { data } = await salesApi.post("/sales/leads", {
        ...form,
        estimatedValue: Number(form.estimatedValue) || 0,
        followUpOn: form.followUpOn || undefined,
      });
      setCreating(false);
      setForm(BLANK);
      setNotice(data.message || "Lead added");
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add that lead");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Lead",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.company || row.email || row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <span className="text-xs capitalize text-slate-600">
          {String(row.source || "").replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      render: (row) => <Badge value={row.stage} tone={STAGE_TONE[row.stage]} />,
    },
    {
      key: "estimatedValue",
      header: "Value",
      render: (row) => <span className="text-slate-700">{money(row.estimatedValue)}</span>,
    },
    {
      key: "followUpOn",
      header: "Next",
      render: (row) => {
        if (!row.followUpOn) return <span className="text-xs text-slate-400">—</span>;
        const late = new Date(row.followUpOn) < new Date(new Date().setHours(0, 0, 0, 0));
        return (
          <span className={late ? "text-xs font-medium text-red-600" : "text-xs text-slate-600"}>
            {shortDate(row.followUpOn)}
            {late ? " · overdue" : ""}
          </span>
        );
      },
    },
    // Only a head reads the list to find out whose deal it is
    ...(isSalesHead
      ? [
          {
            key: "owner",
            header: "Owner",
            render: (row) => (
              /**
               * A real assignment first, then the name typed on the admin
               * form. Only the account decides who sees the lead, so it wins
               * the label too — but a lead with a name against it must not
               * read "Unassigned" here when somebody is plainly chasing it.
               */
              <span className="text-xs text-slate-600">
                {row.owner?.name || row.ownerName || "Unassigned"}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSalesHead ? "All leads" : "My leads"}
        subtitle={
          isSalesHead
            ? "Everything in the pipeline, whoever is carrying it"
            : "The leads assigned to you"
        }
      >
        {can("leads", "create") && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Add lead
          </Button>
        )}
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search name, company, phone or requirement"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="w-40"
            options={[
              { value: "open", label: "Open only" },
              { value: "all", label: "Every stage" },
              ...LEAD_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
            ]}
          />
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Any source"
            className="w-40"
            options={LEAD_SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
          />
          {isSalesHead && (
            <Select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Anyone"
              className="w-44"
              options={people.map((p) => ({ value: p._id, label: p.name }))}
            />
          )}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={openLead}
          emptyTitle="No leads here"
          emptyMessage="Add one, or widen the filters above."
        />
      </Card>

      {/* ------------------------------------------------------- new lead */}

      <Modal
        open={creating}
        title="Add a lead"
        subtitle="It will be yours unless you are a head assigning it on"
        onClose={() => setCreating(false)}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={createLead} disabled={saving}>
              {saving ? "Saving…" : "Add lead"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={createLead}>
          {formError && <Alert>{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input name="name" value={form.name} onChange={change} required />
            </Field>
            <Field label="Company">
              <Input name="company" value={form.company} onChange={change} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" hint="Needed before the lead can be converted">
              <Input type="email" name="email" value={form.email} onChange={change} />
            </Field>
            <Field label="Phone">
              <Input name="phone" value={form.phone} onChange={change} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source">
              <Select
                name="source"
                value={form.source}
                onChange={change}
                options={LEAD_SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
              />
            </Field>
            <Field label="Where exactly" hint="Which referral, which portal">
              <Input name="sourceDetail" value={form.sourceDetail} onChange={change} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <Input name="city" value={form.city} onChange={change} />
            </Field>
            <Field label="Rough value">
              <Input
                type="number"
                name="estimatedValue"
                value={form.estimatedValue}
                onChange={change}
                placeholder="0"
              />
            </Field>
            <Field label="Follow up on">
              <Input type="date" name="followUpOn" value={form.followUpOn} onChange={change} />
            </Field>
          </div>

          <Field label="What they asked for" hint="In their words — the detail comes later">
            <Textarea name="requirement" rows={3} value={form.requirement} onChange={change} />
          </Field>
        </form>
      </Modal>

      {/* --------------------------------------------------- the lead drawer */}

      <LeadDrawer
        detail={detail}
        busy={detailBusy}
        people={people}
        isSalesHead={isSalesHead}
        onClose={() => setDetail(null)}
        onChanged={refreshDetail}
        onNotice={setNotice}
      />
    </div>
  );
}

/* ==================================================================== */

/**
 * Everything about one lead, and every action that can be taken on it.
 *
 * Kept in this file rather than split out because it is only ever opened from
 * the list, and the two share the reload. Split, the pair would need a store
 * between them to stay in step over one button press.
 */
function LeadDrawer({ detail, busy, people, isSalesHead, onClose, onChanged, onNotice }) {
  const [tab, setTab] = useState("timeline");
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [err, setErr] = useState("");

  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");

  const lead = detail?.item;

  useEffect(() => {
    setTab("timeline");
    setNote("");
    setErr("");
    setLostOpen(false);
    setLostReason("");
  }, [lead?._id]);

  if (!lead) return null;

  const act = async (fn) => {
    setBusyAction(true);
    setErr("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e.response?.data?.message || "That did not work");
    } finally {
      setBusyAction(false);
    }
  };

  const setStage = (stage, reason) =>
    act(async () => {
      await salesApi.put(`/sales/leads/${lead._id}/stage`, { stage, lostReason: reason });
      onNotice(`Moved to ${stage}`);
      setLostOpen(false);
    });

  const addNote = () =>
    act(async () => {
      if (!note.trim()) return;
      await salesApi.post(`/sales/leads/${lead._id}/notes`, { body: note });
      setNote("");
    });

  const convert = () =>
    act(async () => {
      const { data } = await salesApi.post(`/sales/leads/${lead._id}/convert`);
      onNotice(data.message || "Converted to a client");
    });

  const assign = (ownerId) =>
    act(async () => {
      const { data } = await salesApi.put(`/sales/leads/${lead._id}/assign`, { owner: ownerId });
      onNotice(data.message || "Reassigned");
    });

  const TABS = [
    { key: "timeline", label: "Timeline", icon: MessageSquarePlus },
    { key: "followups", label: `Follow-ups (${detail.followUps?.length || 0})`, icon: PhoneCall },
    { key: "requirements", label: `Requirements (${detail.requirements?.length || 0})`, icon: ClipboardList },
  ];

  return (
    <Modal
      open
      title={lead.name}
      subtitle={[lead.company, lead.phone, lead.email].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {lead.stage !== "won" && (
            <Button onClick={() => setStage("won")} disabled={busyAction}>
              Mark won
            </Button>
          )}
          {lead.stage === "won" && !lead.convertedClient && (
            <Button onClick={convert} disabled={busyAction}>
              <UserCheck size={14} /> Convert to client
            </Button>
          )}
        </>
      }
    >
      {busy && <p className="text-sm text-slate-500">Loading…</p>}
      {err && <Alert>{err}</Alert>}

      {/* --------------------------------------------------- stage & owner */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge value={lead.stage} tone={STAGE_TONE[lead.stage]} />
        <span className="text-sm text-slate-500">{money(lead.estimatedValue)}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={lead.stage}
            onChange={(e) =>
              e.target.value === "lost" ? setLostOpen(true) : setStage(e.target.value)
            }
            className="w-40"
            options={LEAD_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
          />
          {isSalesHead && (
            <Select
              value={lead.owner?._id || ""}
              onChange={(e) => assign(e.target.value)}
              placeholder="Assign to"
              className="w-44"
              options={people.map((p) => ({ value: p._id, label: p.name }))}
            />
          )}
        </div>
      </div>

      {lead.convertedClient && (
        <Alert tone="success">
          Converted to client &ldquo;{lead.convertedClient.name}&rdquo;
        </Alert>
      )}
      {lead.stage === "lost" && lead.lostReason && (
        <Alert>Lost — {lead.lostReason}</Alert>
      )}

      {/* ------------------------------------------------------ lost reason */}
      {lostOpen && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <Field label="Why was it lost?" required>
            <Input
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Price, timing, went elsewhere…"
            />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!lostReason.trim() || busyAction}
              onClick={() => setStage("lost", lostReason)}
            >
              Mark lost
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ tabs */}
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "timeline" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was said?"
              onKeyDown={(e) => e.key === "Enter" && addNote()}
            />
            <Button onClick={addNote} disabled={busyAction || !note.trim()}>
              Add
            </Button>
          </div>

          {lead.requirement && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p className="mb-1 text-xs font-medium text-slate-500">What they asked for</p>
              {lead.requirement}
            </div>
          )}

          <div className="space-y-2">
            {[...(detail.activities || []).map((a) => ({
              at: a.occurredAt,
              who: a.byName,
              text: `${a.type.replace(/_/g, " ")}${a.summary ? ` — ${a.summary}` : ""}`,
              kind: "activity",
            })),
            ...(lead.notes || []).map((n) => ({
              at: n.at,
              who: n.byName,
              text: n.body,
              kind: "note",
            }))]
              .sort((a, b) => new Date(b.at) - new Date(a.at))
              .map((row, i) => (
                <div key={i} className="border-l-2 border-slate-200 pl-3 text-sm">
                  <p className="text-slate-800">{row.text}</p>
                  <p className="text-[11px] text-slate-400">
                    {row.who || "—"} · {shortDate(row.at)}
                    {row.kind === "activity" ? " · logged" : ""}
                  </p>
                </div>
              ))}
            {!(detail.activities || []).length && !(lead.notes || []).length && (
              <p className="text-sm text-slate-500">Nothing logged yet.</p>
            )}
          </div>
        </div>
      )}

      {tab === "followups" && (
        <FollowUpTab lead={lead} rows={detail.followUps || []} onChanged={onChanged} />
      )}

      {tab === "requirements" && (
        <RequirementTab lead={lead} rows={detail.requirements || []} onChanged={onChanged} />
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- sub-tabs */

function FollowUpTab({ lead, rows, onChanged }) {
  const [form, setForm] = useState({ title: "", dueOn: "", mode: "call" });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!form.title.trim() || !form.dueOn) return;
    setBusy(true);
    try {
      await salesApi.post("/sales/followups", { lead: lead._id, ...form });
      setForm({ title: "", dueOn: "", mode: "call" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const complete = async (id) => {
    setBusy(true);
    try {
      await salesApi.put(`/sales/followups/${id}/complete`, { status: "done" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input
          placeholder="What are you promising?"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Input
          type="date"
          value={form.dueOn}
          onChange={(e) => setForm({ ...form, dueOn: e.target.value })}
          className="w-40"
        />
        <Select
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value })}
          className="w-32"
          options={["call", "meeting", "email", "whatsapp", "site_visit"].map((m) => ({
            value: m,
            label: m.replace(/_/g, " "),
          }))}
        />
        <Button onClick={add} disabled={busy}>
          Book
        </Button>
      </div>

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-500">Nothing booked.</p>}
        {rows.map((f) => (
          <div key={f._id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-slate-800">{f.title}</p>
              <p className="text-[11px] text-slate-500">
                {shortDate(f.dueOn)} · {f.mode} · {f.assignedTo?.name || "—"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge value={f.status} />
              {f.status === "pending" && (
                <Button size="sm" variant="ghost" onClick={() => complete(f._id)} disabled={busy}>
                  Done
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequirementTab({ lead, rows, onChanged }) {
  const [form, setForm] = useState({ title: "", summary: "", budgetFrom: "", budgetTo: "", timeline: "" });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await salesApi.post("/sales/requirements", {
        lead: lead._id,
        ...form,
        budgetFrom: Number(form.budgetFrom) || 0,
        budgetTo: Number(form.budgetTo) || 0,
      });
      setForm({ title: "", summary: "", budgetFrom: "", budgetTo: "", timeline: "" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <Input
          placeholder="What do they need?"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Textarea
          rows={2}
          placeholder="The scope as agreed — this is what delivery inherits"
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
        />
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            type="number"
            placeholder="Budget from"
            value={form.budgetFrom}
            onChange={(e) => setForm({ ...form, budgetFrom: e.target.value })}
          />
          <Input
            type="number"
            placeholder="to"
            value={form.budgetTo}
            onChange={(e) => setForm({ ...form, budgetTo: e.target.value })}
          />
          <Input
            placeholder="Timeline"
            value={form.timeline}
            onChange={(e) => setForm({ ...form, timeline: e.target.value })}
          />
          <Button onClick={add} disabled={busy}>
            Capture
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-500">Nothing captured yet.</p>}
        {rows.map((r) => (
          <div key={r._id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-slate-900">{r.title}</p>
              <Badge value={r.status} />
            </div>
            {r.summary && <p className="mt-1 text-slate-600">{r.summary}</p>}
            <p className="mt-1 text-[11px] text-slate-500">
              {r.budgetFrom || r.budgetTo
                ? `${money(r.budgetFrom)} – ${money(r.budgetTo)}`
                : "No budget given"}
              {r.timeline ? ` · ${r.timeline}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
