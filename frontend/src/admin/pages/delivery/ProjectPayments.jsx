import { useEffect, useState } from "react";
import { AlertTriangle, IndianRupee, Receipt, Wallet } from "lucide-react";

import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Loader,
  PageHeader,
} from "../../../shared/components/ui";
import { money, prettify } from "../../../shared/format";

/**
 * What every project is worth, what has been billed, and what has come in.
 *
 * ADMINISTRATOR ONLY, and there is no version of this screen for anybody else.
 * The route behind it is mounted on the admin router alone and guarded by the
 * CRM permission rather than the projects one — somebody who runs delivery
 * needs the project, and does not thereby need the client's payment references
 * or what they still owe. See controllers/projectPaymentController.js.
 *
 * THE FOUR NUMBERS ARE NOT THE SAME NUMBER
 *
 *   contract value   what the work was sold for
 *   invoiced         what has actually been asked for
 *   paid             what has arrived
 *   unbilled         sold but never invoiced — a different problem, with a
 *                    different owner, from money that is overdue
 *
 * A project can be over budget, under-invoiced and fully paid at once, and all
 * four of those are true statements about different things. Showing one figure
 * called "outstanding" would collapse two problems into a number nobody could
 * act on.
 */

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const STATUS_TONE = {
  paid: "green",
  partly_paid: "amber",
  sent: "blue",
  overdue: "red",
  draft: "slate",
  cancelled: "slate",
};

export default function ProjectPayments() {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    adminApi
      .get("/admin/project-payments")
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotals(data.totals || {});
        setError("");
      })
      .catch((err) =>
        active && setError(err.response?.data?.message || "Could not load the payment figures")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
    // Read-only screen: nothing here writes, so nothing re-triggers the fetch.
  }, []);

  const open = async (row) => {
    setDetailLoading(true);
    setDetail({ project: { name: row.name } });
    try {
      const { data } = await adminApi.get(`/admin/project-payments/${row._id}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that project");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  /** Filtered here rather than on the server — the list is one page of projects. */
  const visible = search.trim()
    ? rows.filter((r) =>
        [r.name, r.code, r.client?.name, r.client?.company]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(search.trim().toLowerCase()))
      )
    : rows;

  const columns = [
    {
      key: "name",
      header: "Project",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">
            {row.client?.name || "No client"}
            {row.code ? ` · ${row.code}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "contractValue",
      header: "Sold for",
      render: (row) => <span className="text-slate-700">{money(row.contractValue)}</span>,
    },
    {
      key: "invoiced",
      header: "Invoiced",
      render: (row) => (
        <div>
          <p className="text-slate-700">{money(row.invoiced)}</p>
          {row.unbilled > 0 && (
            <p className="text-[11px] text-amber-600" title="Agreed but never invoiced">
              {money(row.unbilled)} unbilled
            </p>
          )}
        </div>
      ),
    },
    {
      key: "paid",
      header: "Received",
      render: (row) => (
        <div>
          <p className="font-medium text-green-700">{money(row.paid)}</p>
          <p className="text-[11px] text-slate-400">{row.collectedPercent}% of invoiced</p>
        </div>
      ),
    },
    {
      key: "outstanding",
      header: "Owed",
      render: (row) => (
        <span className={row.outstanding > 0 ? "font-medium text-slate-900" : "text-slate-300"}>
          {row.outstanding > 0 ? money(row.outstanding) : "—"}
        </span>
      ),
    },
    {
      key: "due",
      header: "Oldest due",
      render: (row) =>
        row.oldestDue ? (
          <span className={row.overdue ? "font-medium text-red-600" : "text-slate-600"}>
            {shortDate(row.oldestDue)}
            {row.overdue && <AlertTriangle size={12} className="ml-1 inline" />}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Project payments"
        subtitle="What each project is worth, what has been billed, and what has arrived"
      />

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Loader label="Adding it up…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            {[
              { label: "Contract value", value: money(totals.contractValue), icon: IndianRupee },
              { label: "Invoiced", value: money(totals.invoiced), icon: Receipt },
              {
                label: "Received",
                value: money(totals.paid),
                icon: Wallet,
                tone: "text-green-700",
              },
              { label: "Owed", value: money(totals.outstanding), tone: "text-slate-900" },
              {
                // Sold and never asked for. Not overdue — nobody has been
                // billed — but it is money the company has decided not to
                // collect yet, which is worth its own tile.
                label: "Never invoiced",
                value: money(totals.unbilled),
                tone: "text-amber-700",
              },
            ].map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  {s.icon && <s.icon size={12} />}
                  {s.label}
                </p>
                <p className={`mt-0.5 text-lg font-semibold ${s.tone || "text-slate-900"}`}>
                  {s.value}
                </p>
              </Card>
            ))}
          </div>

          {totals.overdueProjects > 0 && (
            <Alert>
              {totals.overdueProjects} project
              {totals.overdueProjects === 1 ? " has" : "s have"} an invoice past its due date.
            </Alert>
          )}

          <Card>
            <div className="border-b border-slate-200 p-3">
              <Input
                placeholder="Search project or client"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <DataTable
              columns={columns}
              rows={visible}
              onRowClick={open}
              emptyTitle="No projects to bill"
              emptyMessage="Projects appear here as soon as one exists, invoiced or not."
            />
          </Card>
        </>
      )}

      {/* ------------------------------------------------------ one project */}

      <Modal
        open={Boolean(detail)}
        title={detail?.project?.name || ""}
        subtitle={detail?.project?.client?.name || undefined}
        onClose={() => setDetail(null)}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detailLoading || !detail?.totals ? (
          <Loader label="Loading the ledger…" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                ["Sold for", money(detail.totals.contractValue)],
                ["Invoiced", money(detail.totals.invoiced)],
                ["Received", money(detail.totals.paid), "text-green-700"],
                ["Owed", money(detail.totals.outstanding), "text-slate-900"],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className={`text-sm font-semibold ${tone || "text-slate-800"}`}>{value}</p>
                </div>
              ))}
            </div>

            {detail.totals.unbilled > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {money(detail.totals.unbilled)} of the agreed value has never been invoiced.
              </p>
            )}

            {/* ------------------------------------------------ still owed */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pending invoices
              </p>
              {detail.pending?.length ? (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detail.pending.map((i) => (
                    <div key={i._id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800">
                          {i.number} {i.title ? `· ${i.title}` : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          Due {shortDate(i.dueOn)}
                          {i.overdue && (
                            <span className="ml-1 font-medium text-red-600">
                              · {i.daysOverdue} day{i.daysOverdue === 1 ? "" : "s"} late
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-slate-900">{money(i.balance)}</p>
                        <Badge value={prettify(i.status)} tone={STATUS_TONE[i.status]} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
                  Nothing outstanding on this project.
                </p>
              )}
            </div>

            {/* --------------------------------------------- what came in */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payment history
              </p>
              {detail.history?.length ? (
                <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {detail.history.map((p) => (
                    <div key={p._id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">
                          {money(p.amount)}
                          <span className="ml-2 text-xs text-slate-500">
                            {prettify(p.mode)}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </span>
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {shortDate(p.receivedOn)}
                          {p.invoice?.number ? ` · against ${p.invoice.number}` : ""}
                          {p.recordedBy ? ` · recorded by ${p.recordedBy}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Wallet} title="Nothing received yet" />
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
