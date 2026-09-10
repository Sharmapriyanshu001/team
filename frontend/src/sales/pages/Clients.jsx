import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, FolderPlus, Plus, Send, Share2 } from "lucide-react";

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
import { money, shortDate } from "../constants";

/**
 * The companies Sales owns, and the two things that happen after a win.
 *
 * Winning is not the end of the job — somebody has to turn a signature into
 * work, and somebody in Operations has to own the relationship afterwards.
 * Those are separate on purpose: a signed deal often waits on a kickoff call
 * before anything is built, and collapsing the two leaves half-empty projects
 * on the delivery board.
 *
 * "Awaiting handover" is the number Sales gets asked about in every review, so
 * it is a filter at the top rather than something to work out by eye.
 */

const BLANK_CLIENT = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  gstNumber: "",
  notes: "",
};

export default function Clients() {
  const { isSalesHead } = useSalesAccess();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [takers, setTakers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [handover, setHandover] = useState(params.get("handover") || "");

  const [detail, setDetail] = useState(null);
  const [projectFor, setProjectFor] = useState(null);
  const [handoverFor, setHandoverFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const [projectForm, setProjectForm] = useState({ name: "", budget: "", description: "" });
  const [handoverForm, setHandoverForm] = useState({ accountManager: "", note: "" });

  /** Adding a client directly, without a lead in front of it. */
  const [addingClient, setAddingClient] = useState(false);
  const [clientForm, setClientForm] = useState(BLANK_CLIENT);
  const [portal, setPortal] = useState(null);

  /** Sending one through to HR. */
  const [sharingFor, setSharingFor] = useState(null);
  const [shareNote, setShareNote] = useState("");

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    salesApi
      .get("/sales/clients", {
        params: { search: search || undefined, handover: handover || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load clients"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, handover, reloadKey]);

  useEffect(() => {
    salesApi
      .get("/sales/clients/handover-options")
      .then(({ data }) => setTakers(data.items || []))
      .catch(() => setTakers([]));
  }, []);

  const pickHandover = (value) => {
    setHandover(value);
    setParams(value ? { handover: value } : {}, { replace: true });
  };

  const openClient = async (row) => {
    try {
      const { data } = await salesApi.get(`/sales/clients/${row._id}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that client");
    }
  };

  const startProject = async () => {
    if (!projectFor) return;
    setBusy(true);
    try {
      const { data } = await salesApi.post(`/sales/clients/${projectFor._id}/project`, {
        ...projectForm,
        budget: Number(projectForm.budget) || 0,
      });
      setProjectFor(null);
      setProjectForm({ name: "", budget: "", description: "" });
      setNotice(
        `${data.message}${data.requirementsCarried ? ` · ${data.requirementsCarried} requirement(s) carried across` : ""}`
      );
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that project");
    } finally {
      setBusy(false);
    }
  };

  const doHandover = async () => {
    if (!handoverFor) return;
    setBusy(true);
    try {
      const { data } = await salesApi.put(`/sales/clients/${handoverFor._id}/handover`, handoverForm);
      setHandoverFor(null);
      setHandoverForm({ accountManager: "", note: "" });
      setNotice(data.message || "Handed over");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not hand that over");
    } finally {
      setBusy(false);
    }
  };

  const addClient = async () => {
    setBusy(true);
    try {
      const { data } = await salesApi.post("/sales/clients", clientForm);
      setPortal(data.portal);
      setClientForm(BLANK_CLIENT);
      setNotice(data.message || "Client added");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add that client");
      setAddingClient(false);
    } finally {
      setBusy(false);
    }
  };

  const sendToHr = async () => {
    if (!sharingFor) return;
    setBusy(true);
    try {
      const { data } = await salesApi.post(
        `/sales/clients/${sharingFor._id}/share-hr`,
        { note: shareNote }
      );
      setSharingFor(null);
      setShareNote("");
      setNotice(data.message || "Sent to HR");
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not send that to HR");
      setSharingFor(null);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Client",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.company || row.email || "—"}</p>
        </div>
      ),
    },
    { key: "phone", header: "Phone", render: (row) => row.phone || "—" },
    {
      key: "sharedWithHr",
      header: "HR",
      render: (row) =>
        row.sharedWithHr?.at ? (
          <div>
            <Badge value="sent" tone="green" />
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.sharedWithHr.byName || "—"} · {shortDate(row.sharedWithHr.at)}
            </p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Not sent</span>
        ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "handover",
      header: "Handover",
      render: (row) =>
        row.handedOverAt ? (
          <div>
            <Badge value="done" tone="green" />
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.accountManager?.name || "—"} · {shortDate(row.handedOverAt)}
            </p>
          </div>
        ) : (
          <Badge value="pending" tone="amber" />
        ),
    },
    ...(isSalesHead
      ? [
          {
            key: "owner",
            header: "Owner",
            render: (row) => (
              <span className="text-xs text-slate-600">{row.owner?.name || "—"}</span>
            ),
          },
        ]
      : []),
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setProjectForm({ name: `${row.company || row.name} project`, budget: "", description: "" });
              setProjectFor(row);
            }}
          >
            <FolderPlus size={13} /> Project
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setShareNote("");
              setSharingFor(row);
            }}
          >
            <Share2 size={13} /> {row.sharedWithHr?.at ? "Resend to HR" : "Send to HR"}
          </Button>
          {!row.handedOverAt && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setHandoverFor(row);
              }}
            >
              <Send size={13} /> Hand over
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        subtitle="Won deals, and anybody you signed up directly"
      >
        <Button
          onClick={() => {
            setClientForm(BLANK_CLIENT);
            setPortal(null);
            setAddingClient(true);
          }}
        >
          <Plus size={16} /> Add client
        </Button>
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {counts.awaitingHandover > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            <strong>{counts.awaitingHandover}</strong> client
            {counts.awaitingHandover === 1 ? " is" : "s are"} won but nobody in Operations has
            picked {counts.awaitingHandover === 1 ? "it" : "them"} up yet.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search name, company, email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={handover}
            onChange={(e) => pickHandover(e.target.value)}
            placeholder="All clients"
            className="w-48"
            options={[
              { value: "pending", label: "Awaiting handover" },
              { value: "done", label: "Handed over" },
            ]}
          />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={openClient}
          emptyTitle="No clients yet"
          emptyMessage="Convert a won lead and it will appear here."
        />
      </Card>

      {/* ------------------------------------------------------ add a client */}

      <Modal
        open={addingClient}
        title="Add a client"
        subtitle={
          portal
            ? undefined
            : "For somebody who signed without going through the pipeline"
        }
        onClose={() => setAddingClient(false)}
        size="lg"
        footer={
          portal ? (
            <Button onClick={() => setAddingClient(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setAddingClient(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={addClient} disabled={busy || !clientForm.name.trim() || !clientForm.email.trim()}>
                {busy ? "Adding…" : "Add client"}
              </Button>
            </>
          )
        }
      >
        {portal ? (
          <div className="space-y-3">
            <Alert tone="success">
              Client added. They can sign in to the client portal with these details.
            </Alert>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-slate-600">
                Email: <span className="font-mono text-slate-900">{portal.loginId}</span>
              </p>
              {portal.password ? (
                <p className="text-slate-600">
                  Password: <span className="font-mono text-slate-900">{portal.password}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  No mobile number was given, so portal access is off until an admin sets a
                  password.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input
                  value={clientForm.name}
                  onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Company">
                <Input
                  value={clientForm.company}
                  onChange={(e) => setClientForm({ ...clientForm, company: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" required>
                <Input
                  type="email"
                  value={clientForm.email}
                  onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                  required
                />
              </Field>
              <Field label="Mobile" hint="Becomes their portal password">
                <Input
                  value={clientForm.phone}
                  onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address">
                <Input
                  value={clientForm.address}
                  onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                />
              </Field>
              <Field label="GST number" hint="Needed before you can invoice them">
                <Input
                  value={clientForm.gstNumber}
                  onChange={(e) => setClientForm({ ...clientForm, gstNumber: e.target.value })}
                />
              </Field>
            </div>

            <Field label="What was agreed" hint="Anything HR or delivery will need to know">
              <Textarea
                rows={3}
                value={clientForm.notes}
                onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------- send to HR */}

      <Modal
        open={Boolean(sharingFor)}
        title={sharingFor?.sharedWithHr?.at ? "Send updated details to HR" : "Send details to HR"}
        subtitle={sharingFor?.name}
        onClose={() => setSharingFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSharingFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={sendToHr} disabled={busy}>
              {busy ? "Sending…" : "Send to HR"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-slate-500">What HR will receive</p>
            <p className="text-slate-800">{sharingFor?.name}</p>
            <p className="text-slate-600">
              {[sharingFor?.company, sharingFor?.email, sharingFor?.phone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {sharingFor?.sharedWithHr?.at && (
            <Alert>
              Already sent by {sharingFor.sharedWithHr.byName || "somebody"} on{" "}
              {shortDate(sharingFor.sharedWithHr.at)}. Sending again is how a correction
              travels — the original send stays on the record.
            </Alert>
          )}

          <Field label="Anything to add" hint="Goes to HR with the details">
            <Textarea
              rows={3}
              value={shareNote}
              onChange={(e) => setShareNote(e.target.value)}
              placeholder="Signed for a 6-month retainer, invoicing monthly…"
            />
          </Field>
        </div>
      </Modal>
      {/* ------------------------------------------------------- the drawer */}

      <Modal
        open={Boolean(detail)}
        title={detail?.item?.name || ""}
        subtitle={detail?.item?.company || undefined}
        onClose={() => setDetail(null)}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Billed", value: money(detail.money?.billed) },
                { label: "Received", value: money(detail.money?.received) },
                { label: "Outstanding", value: money(detail.money?.outstanding) },
              ].map((m) => (
                <Card key={m.label} className="p-3">
                  <p className="text-xs text-slate-500">{m.label}</p>
                  <p className="mt-0.5 font-semibold text-slate-900">{m.value}</p>
                </Card>
              ))}
            </div>

            {detail.item?.sourceLead && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Came from</p>
                <p className="text-slate-800">
                  {detail.item.sourceLead.name} ·{" "}
                  {String(detail.item.sourceLead.source || "").replace(/_/g, " ")} ·{" "}
                  {money(detail.item.sourceLead.estimatedValue)}
                </p>
              </div>
            )}

            <Section title={`Projects (${detail.projects?.length || 0})`}>
              {(detail.projects || []).map((p) => (
                <Row key={p._id} left={p.name} right={<Badge value={p.status} />} sub={money(p.budget)} />
              ))}
            </Section>

            <Section title={`Requirements (${detail.requirements?.length || 0})`}>
              {(detail.requirements || []).map((r) => (
                <Row key={r._id} left={r.title} right={<Badge value={r.status} />} sub={r.summary} />
              ))}
            </Section>

            <Section title={`Conversation (${detail.activities?.length || 0})`}>
              {(detail.activities || []).slice(0, 12).map((a) => (
                <Row
                  key={a._id}
                  left={`${a.type.replace(/_/g, " ")}${a.summary ? ` — ${a.summary}` : ""}`}
                  sub={`${a.byName || "—"} · ${shortDate(a.occurredAt)}`}
                />
              ))}
            </Section>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------ new project */}

      <Modal
        open={Boolean(projectFor)}
        title="Open a project"
        subtitle={`For ${projectFor?.name || ""} — Operations picks the team`}
        onClose={() => setProjectFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setProjectFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={startProject} disabled={busy || !projectForm.name.trim()}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="success">
            The requirements captured against this client and its lead are carried into the project
            description, so delivery reads the agreed scope rather than guessing it.
          </Alert>
          <Field label="Project name" required>
            <Input
              value={projectForm.name}
              onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
              required
            />
          </Field>
          <Field label="Budget" hint="Defaults to the deal value if left blank">
            <Input
              type="number"
              value={projectForm.budget}
              onChange={(e) => setProjectForm({ ...projectForm, budget: e.target.value })}
            />
          </Field>
          <Field label="Anything else delivery should know">
            <Textarea
              rows={3}
              value={projectForm.description}
              onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* --------------------------------------------------------- handover */}

      <Modal
        open={Boolean(handoverFor)}
        title="Hand over to Operations"
        subtitle={handoverFor?.name}
        onClose={() => setHandoverFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setHandoverFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={doHandover}
              disabled={busy || !handoverForm.accountManager}
            >
              {busy ? "Handing over…" : "Hand over"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Who is taking this on" required>
            <Select
              value={handoverForm.accountManager}
              onChange={(e) => setHandoverForm({ ...handoverForm, accountManager: e.target.value })}
              placeholder="Choose somebody"
              options={takers.map((t) => ({
                value: t._id,
                label: `${t.name} · ${String(t.role || "").replace(/_/g, " ")}`,
              }))}
            />
          </Field>
          <Field label="Anything they should know" hint="What was promised, who to call, what to avoid">
            <Textarea
              rows={4}
              value={handoverForm.note}
              onChange={(e) => setHandoverForm({ ...handoverForm, note: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function Section({ title, children }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Building2 size={12} /> {title}
      </p>
      <div className="space-y-1.5">
        {items && items.length ? items : <p className="text-xs text-slate-400">Nothing yet.</p>}
      </div>
    </div>
  );
}

function Row({ left, right, sub }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-2">
      <div className="min-w-0">
        <p className="truncate text-slate-800">{left}</p>
        {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
