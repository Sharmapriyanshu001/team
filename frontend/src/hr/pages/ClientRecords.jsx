import { useEffect, useState } from "react";
import { Building2, Mail, MapPin, Phone, Receipt } from "lucide-react";

import hrApi from "../hrApi";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import { Alert, Badge, Button, Card, Input, PageHeader } from "../../shared/components/ui";

/**
 * Client details Sales has sent through.
 *
 * Read-only, and it lists only what somebody in Sales deliberately pressed
 * Send on — not every client in the company. That is the whole difference
 * between this and the admin's client list: this one answers "what has been
 * handed to us", which is a question with a much shorter answer.
 */

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export default function ClientRecords() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/client-records", { params: { search: search || undefined } })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load records"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search]);

  const columns = [
    {
      key: "name",
      header: "Client",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.company || "—"}</p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.email}</p>
          <p className="text-xs text-slate-500">{row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "gstNumber",
      header: "GST",
      render: (row) =>
        row.gstNumber ? (
          <span className="font-mono text-xs text-slate-700">{row.gstNumber}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "sentBy",
      header: "Sent by",
      render: (row) => (
        <div>
          <p className="text-slate-800">
            {row.sharedWithHr?.by?.name || row.sharedWithHr?.byName || "—"}
          </p>
          <p className="text-xs text-slate-500">{shortDate(row.sharedWithHr?.at)}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Client records"
        subtitle="Details Sales has passed on — read-only, Sales owns the relationship"
      />

      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="border-b border-slate-200 p-3">
          <Input
            placeholder="Search name, company, email or GST"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={setOpen}
          emptyTitle="Nothing sent through yet"
          emptyMessage="When somebody in Sales presses Send to HR on a client, it appears here."
        />
      </Card>

      {/* --------------------------------------------------------- the record */}

      <Modal
        open={Boolean(open)}
        title={open?.name || ""}
        subtitle={open?.company || undefined}
        onClose={() => setOpen(null)}
        footer={<Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>}
      >
        {open && (
          <div className="space-y-4 text-sm">
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <Line icon={Mail} label="Email" value={open.email} />
              <Line icon={Phone} label="Mobile" value={open.phone} />
              <Line icon={MapPin} label="Address" value={open.address} />
              <Line icon={Receipt} label="GST" value={open.gstNumber} mono />
              <Line icon={Building2} label="Status" value={open.status} />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">Sent to HR by</p>
              <p className="text-slate-800">
                {open.sharedWithHr?.by?.name || open.sharedWithHr?.byName || "—"} ·{" "}
                {shortDate(open.sharedWithHr?.at)}
              </p>
              {open.sharedWithHr?.note && (
                <p className="mt-1 rounded-lg border border-slate-200 p-2 text-slate-700">
                  {open.sharedWithHr.note}
                </p>
              )}
            </div>

            {open.notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">What was agreed</p>
                <p className="text-slate-700">{open.notes}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">Sales owner</p>
                <p className="text-slate-800">{open.owner?.name || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Account manager</p>
                <p className="text-slate-800">{open.accountManager?.name || "Not handed over yet"}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Line({ icon: Icon, label, value, mono }) {
  return (
    <p className="flex items-center gap-2 text-slate-700">
      <Icon size={13} className="shrink-0 text-slate-400" />
      <span className="w-20 shrink-0 text-xs text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-slate-900" : "text-slate-900"}>{value || "—"}</span>
    </p>
  );
}
