import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, IndianRupee, Plus, Receipt, Trash2, Wallet } from "lucide-react";

import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
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
 *
 * IT WRITES NOW, AND IT WRITES THROUGH THE INVOICE
 *
 * Recording what has arrived used to mean leaving this screen for the CRM,
 * finding the invoice and entering it there — so the screen that knows what is
 * owed was the one screen that could not settle it.
 *
 * What it does NOT do is store a figure of its own. Every write here goes to
 * the invoice the money settles, through the same two endpoints the CRM uses,
 * so the totals on this page stay derived rather than becoming a fourth number
 * that disagrees with the other three. The one case that needed more than a
 * payment is a project sold and never billed: there is nothing to pay against,
 * so an invoice can be raised from here too — the ordinary CRM create, with
 * the project and the unbilled amount already filled in.
 */

const PAYMENT_MODES = ["bank_transfer", "upi", "cheque", "cash", "card", "gateway", "other"];

const todayInput = () => new Date().toISOString().slice(0, 10);

/**
 * The pre-tax figure to put on the invoice line.
 *
 * "Inclusive" means the number typed is what the client pays, which is how a
 * project is sold — ₹23,000 is ₹23,000, not ₹23,000 plus GST. The invoice
 * still has to carry the amount before tax, so it is divided back out.
 */
const billedRate = ({ amount, taxPercent, taxMode }) => {
  const value = Number(amount) || 0;
  const tax = Number(taxPercent) || 0;
  return taxMode === "inclusive" ? value / (1 + tax / 100) : value;
};

/** What the invoice will actually come to, rounded the way the server rounds. */
const billedTotal = (billing) =>
  Math.round(billedRate(billing) * (1 + (Number(billing.taxPercent) || 0) / 100));

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

  const [notice, setNotice] = useState("");
  /** Which projects to list: everything, only what is owed, only what is settled. */
  const [only, setOnly] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Recording one: { invoice, amount, receivedOn, mode, reference, note }
  const [paying, setPaying] = useState(null);
  // Raising one: { amount, description, taxPercent, dueOn }
  const [billing, setBilling] = useState(null);
  // Taking one back: the history entry
  const [undoing, setUndoing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

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
    // Bumped by every write, because the figures above are derived from them.
  }, [reloadKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /**
   * The ledger for one project.
   *
   * Refetched after every write rather than patched from the response: the
   * response is one invoice, and what this shows is every invoice, the
   * payments across all of them and four totals derived from the lot.
   */
  const openProject = useCallback(async (projectId, name) => {
    setDetailLoading(true);
    setDetail((current) => current || { project: { name } });
    try {
      const { data } = await adminApi.get(`/admin/project-payments/${projectId}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open that project");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const open = (row) => {
    setDetail({ project: { name: row.name } });
    openProject(row._id, row.name);
  };

  /** Everything a write does afterwards, in one place. */
  const afterWrite = async (message) => {
    setNotice(message);
    setFormError("");
    reload();
    if (detail?.project?._id) await openProject(detail.project._id, detail.project.name);
  };

  const recordPayment = async () => {
    setBusy(true);
    setFormError("");
    try {
      await adminApi.post(`/admin/crm/invoices/${paying.invoice._id}/payments`, {
        amount: Number(paying.amount),
        receivedOn: paying.receivedOn || undefined,
        mode: paying.mode,
        reference: paying.reference,
        note: paying.note,
      });
      setPaying(null);
      await afterWrite("Payment recorded");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not record that payment");
    } finally {
      setBusy(false);
    }
  };

  const undoPayment = async () => {
    setBusy(true);
    try {
      await adminApi.delete(
        `/admin/crm/invoices/${undoing.invoice._id}/payments/${undoing._id}`
      );
      setUndoing(null);
      await afterWrite("Payment removed");
    } catch (err) {
      setError(err.response?.data?.message || "Could not remove that payment");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Billing what was sold and never invoiced.
   *
   * One line, because that is what this case is — the agreed amount, asked
   * for. Anything with several lines, a rate card or a discount belongs in the
   * CRM's own invoice form, which this deliberately does not reimplement.
   *
   * Raised as "sent" rather than a draft: a draft counts as nothing on this
   * screen, so raising one from here would leave the figure exactly where it
   * was and look like the button had failed.
   */
  const raiseInvoice = async () => {
    setBusy(true);
    setFormError("");
    try {
      await adminApi.post("/admin/crm/invoices", {
        client: detail.project.client?._id,
        project: detail.project._id,
        title: billing.description,
        status: "sent",
        dueOn: billing.dueOn || null,
        lines: [
          {
            description: billing.description,
            quantity: 1,
            /**
             * A line carries the amount BEFORE tax, always. So when somebody
             * says the figure they typed is what the client pays, the rate is
             * worked back out of it — ₹23,000 at 18% is a line of ₹19,491.53,
             * which the server taxes back up to ₹23,000.
             */
            rate: billedRate(billing),
            taxPercent: Number(billing.taxPercent) || 0,
          },
        ],
      });
      setBilling(null);
      await afterWrite("Invoice raised");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not raise that invoice");
    } finally {
      setBusy(false);
    }
  };

  /** Filtered here rather than on the server — the list is one page of projects. */
  const term = search.trim().toLowerCase();
  const visible = rows
    .filter((r) =>
      term
        ? [r.name, r.code, r.client?.name, r.client?.company]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(term))
        : true
    )
    .filter((r) => {
      if (only === "owed") return r.outstanding > 0;
      if (only === "settled") return r.invoiced > 0 && r.outstanding <= 0;
      if (only === "unbilled") return r.unbilled > 0;
      return true;
    });

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
      /**
       * The question this screen is actually asked: of the amount the work was
       * sold for, how much has arrived and how much has not.
       *
       * Measured against the contract rather than against the invoice on
       * purpose. They are rarely the same figure — an invoice carries GST on
       * top, and a project can be part-billed — but "what did we agree" and
       * "what have we got" is the pair somebody holds in their head, and the
       * invoice total is a number in between that answers neither.
       */
      render: (row) => {
        const left = Math.max(0, (row.contractValue || 0) - (row.paid || 0));

        return (
          <div>
            <p className="text-slate-700">{money(row.contractValue)}</p>
            {row.contractValue > 0 &&
              (left > 0 ? (
                <p className="text-[11px] text-slate-500">{money(left)} still to come</p>
              ) : (
                <p className="text-[11px] font-medium text-green-700">all received</p>
              ))}
          </div>
        );
      },
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
      /**
       * The question the screen is opened with — "has it all come in?" — as a
       * word rather than as three numbers to compare. Nothing billed is not
       * the same answer as nothing owed, and both used to read as a row of
       * zeroes and a dash.
       */
      key: "settled",
      header: "Standing",
      render: (row) => {
        if (!row.invoiced)
          return <span className="text-xs text-amber-700">Never invoiced</span>;
        if (row.outstanding <= 0)
          return <span className="text-xs font-medium text-green-700">All in</span>;
        return (
          <span className={`text-xs ${row.overdue ? "font-medium text-red-600" : "text-slate-600"}`}>
            {row.collectedPercent}% in
          </span>
        );
      },
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
      {notice && <Alert tone="success">{notice}</Alert>}

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
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              <Input
                placeholder="Search project or client"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <Select
                value={only}
                onChange={(e) => setOnly(e.target.value)}
                className="w-auto"
                options={[
                  { value: "all", label: "Every project" },
                  { value: "owed", label: "Money still owed" },
                  { value: "settled", label: "Fully paid" },
                  { value: "unbilled", label: "Never invoiced" },
                ]}
              />
              <p className="ml-auto text-xs text-slate-500">
                {visible.length} of {rows.length}
              </p>
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
            {/**
             * The contract, first and on its own line.
             *
             * Everything under this is about invoices, which is the right way
             * to keep the books and the wrong way to answer "of the twenty
             * three thousand, what have we got". So that sentence is put at
             * the top in the words it is asked in, and the invoice detail
             * follows for whoever needs it.
             */}
            {detail.totals.contractValue > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Of the {money(detail.totals.contractValue)} it was sold for
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-green-700">
                      {money(detail.totals.paid)} received
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Still to come</p>
                    <p className="text-lg font-semibold text-slate-900">
                      {money(Math.max(0, detail.totals.contractValue - detail.totals.paid))}
                    </p>
                  </div>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((detail.totals.paid / detail.totals.contractValue) * 100)
                      )}%`,
                    }}
                  />
                </div>

                {/* Received can pass the contract value — an invoice carries
                    tax the agreed figure did not — and saying so is better
                    than a bar that quietly sits at 100% */}
                {detail.totals.paid > detail.totals.contractValue && (
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {money(detail.totals.paid - detail.totals.contractValue)} more than the agreed
                    figure has come in — invoices carry tax on top of it.
                  </p>
                )}
              </div>
            )}

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
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  {money(detail.totals.unbilled)} of the agreed value has never been invoiced.
                </p>
                {/**
                 * Without an invoice there is nothing for a payment to settle,
                 * so on a project billed for nothing this is the only button
                 * that can lead anywhere.
                 */}
                {detail.project?.client?._id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFormError("");
                      setBilling({
                        amount: String(detail.totals.unbilled),
                        description: detail.project.name || "Project work",
                        taxPercent: "18",
                        // What was agreed is what the client was told they
                        // would pay, so that is what the invoice adds up to
                        taxMode: "inclusive",
                        dueOn: "",
                      });
                    }}
                  >
                    <Plus size={13} /> Raise an invoice
                  </Button>
                ) : (
                  <span className="text-xs text-amber-700">
                    No client on this project — an invoice needs one
                  </span>
                )}
              </div>
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
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">{money(i.balance)}</p>
                          <Badge value={prettify(i.status)} tone={STATUS_TONE[i.status]} />
                        </div>
                        {/* A draft is still being typed; the server refuses a
                            payment against one, so it is not offered */}
                        {i.status !== "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setFormError("");
                              setPaying({
                                invoice: i,
                                // The usual case is that the whole thing arrived
                                amount: String(i.balance),
                                receivedOn: todayInput(),
                                mode: "bank_transfer",
                                reference: "",
                                note: "",
                              });
                            }}
                          >
                            Record payment
                          </Button>
                        )}
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
                      {/* Money entered twice, or against the wrong invoice, is
                          the mistake this has to be able to take back */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setUndoing(p)}
                        title="Remove this payment"
                      >
                        <Trash2 size={13} />
                      </Button>
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

      {/* ------------------------------------------------ record what arrived */}

      <Modal
        open={Boolean(paying)}
        title="Record a payment"
        subtitle={paying ? `${paying.invoice.number} · ${money(paying.invoice.balance)} outstanding` : undefined}
        onClose={() => setPaying(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={recordPayment} disabled={busy || !(Number(paying?.amount) > 0)}>
              {busy ? "Saving…" : "Record it"}
            </Button>
          </>
        }
      >
        {paying && (
          <div className="space-y-4">
            {formError && <Alert>{formError}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Amount received"
                required
                hint={
                  Number(paying.amount) > paying.invoice.balance
                    ? "More than is outstanding — the server will refuse this"
                    : undefined
                }
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paying.amount}
                  onChange={(e) => setPaying((p) => ({ ...p, amount: e.target.value }))}
                />
              </Field>

              <Field label="Received on">
                <Input
                  type="date"
                  value={paying.receivedOn}
                  onChange={(e) => setPaying((p) => ({ ...p, receivedOn: e.target.value }))}
                />
              </Field>

              <Field label="How it came">
                <Select
                  value={paying.mode}
                  onChange={(e) => setPaying((p) => ({ ...p, mode: e.target.value }))}
                  options={PAYMENT_MODES}
                />
              </Field>

              <Field label="Reference" hint="UTR, cheque number, transaction id">
                <Input
                  value={paying.reference}
                  onChange={(e) => setPaying((p) => ({ ...p, reference: e.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>

            <Field label="Note">
              <Textarea
                rows={2}
                value={paying.note}
                onChange={(e) => setPaying((p) => ({ ...p, note: e.target.value }))}
                placeholder="Anything worth remembering about this payment"
              />
            </Field>

            {/* The invoice settles itself from its payments — this is what it
                will say once this one is in, so nobody has to guess */}
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {Number(paying.amount) >= paying.invoice.balance
                ? `This settles ${paying.invoice.number} in full.`
                : `${money(paying.invoice.balance - (Number(paying.amount) || 0))} would still be owed on ${paying.invoice.number}.`}
            </p>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------- bill what was never billed */}

      <Modal
        open={Boolean(billing)}
        title="Raise an invoice"
        subtitle={detail?.project?.client?.name ? `Billed to ${detail.project.client.name}` : undefined}
        onClose={() => setBilling(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBilling(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={raiseInvoice}
              disabled={busy || !(Number(billing?.amount) > 0) || !billing?.description.trim()}
            >
              {busy ? "Raising…" : "Raise it"}
            </Button>
          </>
        }
      >
        {billing && (
          <div className="space-y-4">
            {formError && <Alert>{formError}</Alert>}

            <Field label="What for" required>
              <Input
                value={billing.description}
                onChange={(e) => setBilling((b) => ({ ...b, description: e.target.value }))}
                placeholder="Website build — phase 1"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" required>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={billing.amount}
                  onChange={(e) => setBilling((b) => ({ ...b, amount: e.target.value }))}
                />
              </Field>

              {/**
               * Which of the two figures was typed.
               *
               * The one that catches people out: a project sold for ₹23,000
               * invoiced "₹23,000 plus 18%" bills ₹27,140, and then nothing on
               * the screen adds up to what was agreed with the client. So the
               * default is that the amount IS the bill, and adding tax on top
               * is the deliberate choice.
               */}
              <Field label="That amount is">
                <Select
                  value={billing.taxMode}
                  onChange={(e) => setBilling((b) => ({ ...b, taxMode: e.target.value }))}
                  options={[
                    { value: "inclusive", label: "What the client pays, tax included" },
                    { value: "exclusive", label: "Before tax — add it on top" },
                  ]}
                />
              </Field>

              <Field label="Tax %">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={billing.taxPercent}
                  onChange={(e) => setBilling((b) => ({ ...b, taxPercent: e.target.value }))}
                />
              </Field>

              <Field label="Due on">
                <Input
                  type="date"
                  value={billing.dueOn}
                  onChange={(e) => setBilling((b) => ({ ...b, dueOn: e.target.value }))}
                />
              </Field>
            </div>

            {/**
             * The total worked out in front of somebody rather than discovered
             * on the next screen. The server does the real sum — CGST/SGST or
             * IGST depending on the client's state — but it lands on this
             * figure, which is the one that has to match what was agreed.
             */}
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Invoice total{" "}
              <span className="font-semibold text-slate-900">{money(billedTotal(billing))}</span>
              {billing.taxMode === "inclusive"
                ? ` — ${money(billedRate(billing))} plus ${billing.taxPercent || 0}% tax.`
                : ` — ${money(Number(billing.amount) || 0)} plus ${billing.taxPercent || 0}% tax on top.`}{" "}
              Raised as sent, so it counts as billed straight away.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(undoing)}
        title="Remove this payment?"
        message={
          undoing
            ? `${money(undoing.amount)} received on ${shortDate(undoing.receivedOn)} against ${
                undoing.invoice?.number || "an invoice"
              }. The invoice goes back to what it was owed before this was entered.`
            : ""
        }
        confirmLabel="Remove it"
        loading={busy}
        onConfirm={undoPayment}
        onClose={() => setUndoing(null)}
      />
    </div>
  );
}
