import { useCallback, useEffect, useState } from "react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import { Alert, Badge, Card, Loader, PageHeader } from "../../shared/components/ui";
import { OPEN_STAGES, STAGE_TONE, money, prettify, shortDate } from "../constants";

/**
 * The deal board.
 *
 * The same records as the Leads table, drawn as columns. Both exist because
 * they answer different questions: a table is for finding one person, a board
 * is for reading the week. Somebody asked "how are we doing" wants the second
 * and will not get it from a sorted list.
 *
 * Won and lost are deliberately not columns. A board is for work in progress;
 * closed deals belong in the report, and giving them columns makes the live
 * ones look like a minority of the work.
 */

export default function Pipeline() {
  const { isSalesHead } = useSalesAccess();

  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, pipe] = await Promise.all([
        salesApi.get("/sales/leads", { params: { stage: "open" } }),
        salesApi.get("/sales/leads/pipeline"),
      ]);
      setLeads(list.data.items || []);
      setSummary(pipe.data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Moving a deal forward, one stage at a time.
   *
   * Deliberately buttons rather than drag-and-drop: dragging on a touch screen
   * on a sales floor moves the wrong card often enough to matter, and losing a
   * deal needs a reason typed in, which a drop cannot ask for. Backwards moves
   * and losses are done from the lead itself.
   */
  const advance = async (lead, stage) => {
    setMoving(lead._id);
    try {
      await salesApi.put(`/sales/leads/${lead._id}/stage`, { stage });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not move that deal");
    } finally {
      setMoving("");
    }
  };

  if (loading && !summary) return <Loader label="Loading the board…" />;

  const byStage = {};
  OPEN_STAGES.forEach((s) => {
    byStage[s] = [];
  });
  leads.forEach((l) => {
    if (byStage[l.stage]) byStage[l.stage].push(l);
  });

  const totals = {};
  (summary?.stages || []).forEach((s) => {
    totals[s.stage] = s;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deal pipeline"
        subtitle={
          isSalesHead
            ? "Every live deal on the floor"
            : "Your live deals — closed ones are in Reports"
        }
      />

      {error && <Alert>{error}</Alert>}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="px-4 py-3">
            <p className="text-xs text-slate-500">Open deals</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{summary.open.count}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-xs text-slate-500">Open value</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{money(summary.open.value)}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-xs text-slate-500">Won</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">{summary.won.count}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-xs text-slate-500">Conversion</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{summary.conversionRate}%</p>
          </Card>
        </div>
      )}

      {/* The board scrolls sideways rather than squashing the columns — five
          unreadable columns is worse than five readable ones you scroll. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {OPEN_STAGES.map((stage, i) => {
            const cards = byStage[stage] || [];
            const next = OPEN_STAGES[i + 1];

            return (
              <div key={stage} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between">
                  <Badge value={stage} tone={STAGE_TONE[stage]} />
                  <span className="text-xs text-slate-500">
                    {cards.length} · {money(totals[stage]?.value || 0)}
                  </span>
                </div>

                <div className="space-y-2">
                  {cards.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                      Nothing here
                    </div>
                  )}

                  {cards.map((lead) => (
                    <Card key={lead._id} className="p-3">
                      <p className="truncate text-sm font-medium text-slate-900">{lead.name}</p>
                      <p className="truncate text-xs text-slate-500">{lead.company || "—"}</p>

                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">
                          {money(lead.estimatedValue)}
                        </span>
                        {lead.followUpOn && (
                          <span
                            className={
                              new Date(lead.followUpOn) < new Date(new Date().setHours(0, 0, 0, 0))
                                ? "font-medium text-red-600"
                                : "text-slate-500"
                            }
                          >
                            {shortDate(lead.followUpOn)}
                          </span>
                        )}
                      </div>

                      {isSalesHead && lead.owner?.name && (
                        <p className="mt-1 truncate text-[11px] text-slate-400">
                          {lead.owner.name}
                        </p>
                      )}

                      {next && (
                        <button
                          type="button"
                          onClick={() => advance(lead, next)}
                          disabled={moving === lead._id}
                          className="mt-2 w-full rounded-md border border-slate-200 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                        >
                          {moving === lead._id ? "Moving…" : `Move to ${prettify(next)}`}
                        </button>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
