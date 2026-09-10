import { useEffect, useState } from "react";

import salesApi from "../salesApi";
import DataTable from "../../shared/components/DataTable";
import { Alert, Badge, Card, Input, PageHeader } from "../../shared/components/ui";
import { money, shortDate } from "../constants";

/**
 * Quotations, read from the same records the admin panel raises and numbers.
 *
 * Deliberately a list rather than a second quotation builder. The admin panel
 * already has one — with the rate card, the line items and the conversion to
 * an invoice — and a parallel builder here would be a second implementation of
 * pricing that drifts from the first the week somebody changes a tax rate.
 * What Sales needs on its own screen is to see where each quote stands.
 */
export default function Quotations() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    salesApi
      .get("/sales/quotations")
      .then(({ data }) => active && setRows(data.items || data || []))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load quotations"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const filtered = search
    ? rows.filter((r) =>
        `${r.number || ""} ${r.title || ""} ${r.client?.name || ""} ${r.clientName || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : rows;

  const columns = [
    {
      key: "number",
      header: "Quotation",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.number || String(r._id).slice(-6)}</p>
          <p className="text-xs text-slate-500">{r.title || "—"}</p>
        </div>
      ),
    },
    {
      key: "client",
      header: "For",
      render: (r) => r.client?.name || r.clientName || "—",
    },
    { key: "total", header: "Value", render: (r) => money(r.total) },
    { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
    { key: "createdAt", header: "Raised", render: (r) => shortDate(r.createdAt) },
    { key: "validUntil", header: "Valid until", render: (r) => shortDate(r.validUntil) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quotations"
        subtitle="What has been priced, and whether it came back"
      />

      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="border-b border-slate-200 p-3">
          <Input
            placeholder="Search number, title or client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          emptyTitle="No quotations yet"
          emptyMessage="Quotations raised against your clients will appear here."
        />
      </Card>
    </div>
  );
}
