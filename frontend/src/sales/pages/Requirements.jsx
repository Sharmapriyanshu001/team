import { useEffect, useState } from "react";

import salesApi from "../salesApi";
import DataTable from "../../shared/components/DataTable";
import { Alert, Badge, Card, Input, PageHeader, Select } from "../../shared/components/ui";
import { money, shortDate } from "../constants";

/**
 * Everything that has been asked for, across every deal.
 *
 * The per-lead view lives inside the lead drawer, where a requirement is
 * captured. This is the other question: what has been promised in total, and
 * how much of it has actually been quoted. A requirement still sitting open
 * weeks after the meeting is a quotation nobody sent.
 */
export default function Requirements() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    salesApi
      .get("/sales/requirements", { params: { status: status || undefined } })
      .then(({ data }) => active && setRows(data.items || []))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load requirements")
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [status]);

  /** Filtered here rather than server-side: the list is capped at 300 anyway. */
  const filtered = search
    ? rows.filter((r) =>
        `${r.title} ${r.summary} ${r.lead?.name || ""} ${r.client?.name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : rows;

  const columns = [
    {
      key: "title",
      header: "Requirement",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.title}</p>
          <p className="max-w-md truncate text-xs text-slate-500">{r.summary || "—"}</p>
        </div>
      ),
    },
    {
      key: "for",
      header: "For",
      render: (r) => (
        <div>
          <p className="text-slate-800">{r.lead?.name || r.client?.name || "—"}</p>
          <p className="text-xs text-slate-500">{r.lead?.company || r.client?.company || ""}</p>
        </div>
      ),
    },
    {
      key: "budget",
      header: "Budget",
      render: (r) =>
        r.budgetFrom || r.budgetTo ? (
          <span className="text-slate-700">
            {money(r.budgetFrom)} – {money(r.budgetTo)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not given</span>
        ),
    },
    { key: "timeline", header: "Timeline", render: (r) => r.timeline || "—" },
    { key: "priority", header: "Priority", render: (r) => <Badge value={r.priority} /> },
    { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
    { key: "createdAt", header: "Captured", render: (r) => shortDate(r.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Requirements"
        subtitle="What has been asked for — and what delivery inherits when it is won"
      />

      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <Input
            placeholder="Search requirement or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Any status"
            className="w-40"
            options={["open", "quoted", "approved", "dropped"].map((s) => ({
              value: s,
              label: s,
            }))}
          />
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          emptyTitle="Nothing captured yet"
          emptyMessage="Requirements are captured from inside a lead, on its Requirements tab."
        />
      </Card>
    </div>
  );
}
