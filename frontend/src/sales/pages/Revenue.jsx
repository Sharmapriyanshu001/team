import { useEffect, useState } from "react";

import salesApi from "../salesApi";
import DataTable from "../../shared/components/DataTable";
import { Alert, Badge, Card, PageHeader } from "../../shared/components/ui";
import { money, shortDate } from "../constants";

/**
 * What was invoiced, and what actually arrived.
 *
 * Read from the invoices rather than from won-deal estimates on purpose: an
 * estimate is what somebody hoped for and a payment is what the bank saw, and
 * a sales report that quietly mixes the two flatters itself.
 */
export default function Revenue() {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    salesApi
      .get("/sales/revenue")
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotals(data.totals || {});
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load revenue"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const columns = [
    { key: "number", header: "Invoice", render: (r) => r.number || String(r._id).slice(-6) },
    {
      key: "client",
      header: "Client",
      render: (r) => (
        <div>
          <p className="text-slate-900">{r.client?.name || "—"}</p>
          <p className="text-xs text-slate-500">{r.client?.company || ""}</p>
        </div>
      ),
    },
    { key: "total", header: "Billed", render: (r) => money(r.total) },
    { key: "paid", header: "Received", render: (r) => money(r.paid) },
    {
      key: "outstanding",
      header: "Outstanding",
      render: (r) => (
        <span className={r.outstanding > 0 ? "font-medium text-amber-700" : "text-slate-500"}>
          {money(r.outstanding)}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
    { key: "createdAt", header: "Raised", render: (r) => shortDate(r.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Revenue" subtitle="Invoiced against received, for the clients you hold" />

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Billed", value: money(totals.billed) },
          { label: "Received", value: money(totals.received) },
          { label: "Outstanding", value: money(totals.outstanding) },
        ].map((t) => (
          <Card key={t.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{t.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="No invoices yet"
          emptyMessage="Invoices raised against your clients will appear here."
        />
      </Card>
    </div>
  );
}
