import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Handshake, Send } from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import usePermissions from "../../hooks/usePermissions";
import DataTable from "../../../shared/components/DataTable";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

/**
 * Won, and nobody in Operations has picked it up.
 *
 * The gap between a deal closing and work starting is where clients get
 * dropped — everybody assumes somebody else has it. This is that gap, as a
 * list, so it is a question the panel answers rather than something noticed
 * three weeks later.
 *
 * A client with a project already running is shown but not flagged: work is
 * happening whether or not the handover was ever filled in. The ones with
 * nothing started are the ones that matter.
 */

const longDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const daysSince = (value) => {
  if (!value) return 0;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
};

export default function HandoverQueue() {
  const navigate = useNavigate();
  const { operationsStaff } = useLookups();
  const { can } = usePermissions();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ accountManager: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    adminApi
      .get("/admin/clients/pending-handover")
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load the queue"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await adminApi.put(`/admin/clients/${target._id}/handover`, form);
      setTarget(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not record the handover");
    } finally {
      setSaving(false);
    }
  };

  const staffOptions = (operationsStaff || []).map((person) => ({
    value: person._id,
    label: person.designation ? `${person.name} — ${person.designation}` : person.name,
  }));

  const columns = [
    {
      key: "name",
      header: "Client",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.company || row.email || "—"}</p>
        </div>
      ),
    },
    {
      key: "sourceLead",
      header: "Deal",
      render: (row) =>
        row.sourceLead ? (
          <div>
            <p className="text-slate-700">
              {row.sourceLead.estimatedValue
                ? `₹${Number(row.sourceLead.estimatedValue).toLocaleString("en-IN")}`
                : "Value not set"}
            </p>
            <p className="text-xs text-slate-400">Won {longDate(row.sourceLead.wonAt)}</p>
          </div>
        ) : (
          <span className="text-slate-400">Added by hand</span>
        ),
    },
    { key: "owner", header: "Sales owner", render: (row) => row.owner?.name || "—" },
    {
      key: "waiting",
      header: "Waiting",
      render: (row) => {
        const days = daysSince(row.createdAt);
        return (
          <span className={days > 14 ? "font-semibold text-red-600" : "text-slate-700"}>
            {days} day{days === 1 ? "" : "s"}
          </span>
        );
      },
    },
    {
      key: "hasProject",
      header: "Work started",
      render: (row) =>
        row.hasProject ? (
          <Badge tone="blue">Project running</Badge>
        ) : (
          <Badge tone="red">Nothing started</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        can("clients", "edit") && (
          <Button
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
              setForm({ accountManager: "", note: "" });
              setFormError("");
            }}
          >
            <Send size={14} />
            Hand over
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Handover Queue"
        subtitle="Clients Sales has won that Operations has not picked up"
      />

      <Alert>{error}</Alert>

      {!loading && data?.unstarted > 0 && (
        <Alert>
          {data.unstarted} of these {data.unstarted === 1 ? "has" : "have"} no project started at
          all.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Waiting for Operations"
          subtitle={
            data
              ? `${data.total} client${data.total === 1 ? "" : "s"} · ${data.unstarted} with nothing started`
              : "Loading"
          }
        />
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          onRowClick={(row) => navigate(`/admin/clients/${row._id}`)}
          emptyTitle="Nothing waiting"
          emptyMessage="Every client has been handed over to Operations."
        />
      </Card>

      {!loading && !data?.items?.length && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 size={13} />
          Clients appear here the moment a deal is won, and drop off as soon as somebody in
          Operations takes them on.
        </p>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Hand over to Operations"
        subtitle={
          target
            ? `${target.name}${target.company ? ` — ${target.company}` : ""}`
            : ""
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              <Handshake size={15} />
              Hand over
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          <Alert>{formError}</Alert>

          <Field label="Who is taking this on" required>
            <Select
              value={form.accountManager}
              onChange={(e) => setForm({ ...form, accountManager: e.target.value })}
              options={staffOptions}
              placeholder="Choose from Operations"
              required
            />
          </Field>

          <Field label="Note" hint="What they need to know to pick this up">
            <Textarea
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Scope is in the quotation, kickoff next Monday"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
