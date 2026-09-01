import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone } from "lucide-react";

import { Alert, Badge, Card, EmptyState, Loader, PageHeader } from "../components/ui";

const rupees = (value) =>
  value === null || value === undefined ? "—" : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;

/**
 * The ad accounts this person runs.
 *
 * The budget and the numbers, and nothing about the money between the studio
 * and the client — what is owed, or how much of an advance is left, is not
 * theirs to see. The server leaves it out; this only has to not ask for it.
 */
export default function MyAdsWork({ api, base, accountPath }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/ads/my-work`)
      .then(({ data }) => active && setRows(data.accounts || []))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your accounts"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base]);

  if (loading) return <Loader label="Loading your ad accounts…" />;

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle={`${rows.length} account${rows.length === 1 ? "" : "s"} you run`}
      />

      <Alert>{error}</Alert>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No ad accounts assigned to you"
            message="When an admin puts you on a Meta or Google account it appears here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <Link
                key={row._id}
                to={`${accountPath}/${row._id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-400">
                    {row.client?.name} · {row.platform}
                  </p>
                </div>

                <Badge value={row.status} />

                {row.pacing ? (
                  <div className="min-w-[9rem]">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="tabular-nums text-slate-700">
                        {rupees(row.pacing.spent)}
                      </span>
                      <span className="tabular-nums text-slate-400">
                        of {rupees(row.pacing.budget)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        style={{ width: `${Math.min(100, row.pacing.usedPercent)}%` }}
                        className={`h-full rounded-full ${
                          row.pacing.variance > 0
                            ? "bg-red-500"
                            : row.pacing.usedPercent >= 75
                              ? "bg-amber-500"
                              : "bg-blue-600"
                        }`}
                      />
                    </div>
                    {row.pacing.variance > 0 && (
                      <p className="mt-1 text-[11px] font-medium text-red-600">
                        On pace to go {rupees(row.pacing.variance)} over
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">No budget set</span>
                )}

                <div className="ml-auto text-right">
                  <p className="text-sm tabular-nums text-slate-900">
                    {row.thisMonth.conversions || 0} results
                  </p>
                  <p className="text-xs text-slate-400">
                    {row.thisMonth.cpa ? `${rupees(row.thisMonth.cpa)} each` : "this month"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
