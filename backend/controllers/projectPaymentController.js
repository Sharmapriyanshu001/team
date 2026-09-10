import Invoice from "../models/Invoice.js";
import Project from "../models/Project.js";

/**
 * The money on a project: what it is worth, what has come in, what has not.
 *
 * ADMINISTRATOR ONLY, and that is the point of the file rather than a note on
 * it. The figures here are assembled from the invoices, and an invoice carries
 * the client's GST number, their billing address and every payment reference
 * the company holds against them. There is no version of this screen that is
 * safe for a client, an operations manager or an employee — so rather than one
 * endpoint with a permission on it, this is mounted only under the admin
 * router and nothing else imports it. The other panels have no route to it at
 * all, which is a stronger guarantee than any check inside a shared handler.
 *
 * WHY THE INVOICES AND NOT A FIELD ON THE PROJECT
 *
 * Project.budget is what the work was sold for. It is not what has been
 * billed, and neither of those is what has been received — a project can be
 * over budget, under-invoiced and fully paid at the same time, and all three
 * are true statements about different things. Storing "paid" on the project
 * would create a fourth number that agrees with none of them the first time
 * somebody records a payment against an invoice, which is exactly where money
 * bugs come from.
 *
 * Draft and cancelled invoices are left out of every total. A draft is
 * something somebody is still typing; counting it as billed would make the
 * outstanding figure move as a colleague edits a form.
 */

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Neither of these is a claim on the client, so neither counts as billed. */
const BILLED = { status: { $nin: ["draft", "cancelled"] } };

/**
 * GET /api/admin/projects/:id/payments
 */
export const projectPayments = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .select("name code budget client status startDate endDate")
      .populate("client", "name company email phone");

    if (!project) return res.status(404).json({ message: "That project was not found" });

    const invoices = await Invoice.find({ project: project._id, ...BILLED })
      .select("number title total amountPaid balance status issuedOn dueOn paidAt payments")
      .sort({ issuedOn: -1 });

    const invoiced = round(invoices.reduce((sum, i) => sum + (i.total || 0), 0));
    const paid = round(invoices.reduce((sum, i) => sum + (i.amountPaid || 0), 0));
    const outstanding = round(invoiced - paid);

    /**
     * What was agreed but never billed. A project sold for ten lakh with six
     * invoiced is not "40% outstanding", it is 40% that nobody has asked for
     * yet — a different problem with a different owner, so it is a different
     * number.
     */
    const unbilled = round(Math.max(0, (project.budget || 0) - invoiced));

    const today = new Date();

    /** Every payment across every invoice, newest first. The audit trail. */
    const history = invoices
      .flatMap((invoice) =>
        (invoice.payments || []).map((p) => ({
          _id: p._id,
          amount: p.amount,
          receivedOn: p.receivedOn,
          mode: p.mode,
          reference: p.reference || "",
          note: p.note || "",
          recordedBy: p.recordedByName || "",
          invoice: { _id: invoice._id, number: invoice.number, title: invoice.title },
        }))
      )
      .sort((a, b) => new Date(b.receivedOn) - new Date(a.receivedOn));

    /** Money asked for and not received. Overdue is a subset, flagged not split. */
    const pending = invoices
      .filter((i) => (i.balance || 0) > 0)
      .map((i) => ({
        _id: i._id,
        number: i.number,
        title: i.title,
        total: i.total,
        amountPaid: i.amountPaid,
        balance: i.balance,
        status: i.status,
        issuedOn: i.issuedOn,
        dueOn: i.dueOn,
        overdue: Boolean(i.dueOn && new Date(i.dueOn) < today),
        daysOverdue: i.dueOn
          ? Math.max(0, Math.ceil((today - new Date(i.dueOn)) / 86400000))
          : 0,
      }))
      .sort((a, b) => new Date(a.dueOn || 0) - new Date(b.dueOn || 0));

    return res.status(200).json({
      project: {
        _id: project._id,
        name: project.name,
        code: project.code,
        status: project.status,
        client: project.client,
      },
      totals: {
        /** What it was sold for. */
        contractValue: round(project.budget),
        invoiced,
        paid,
        outstanding,
        unbilled,
        overdue: round(pending.filter((p) => p.overdue).reduce((s, p) => s + p.balance, 0)),
        collectedPercent: invoiced ? Math.round((paid / invoiced) * 100) : 0,
      },
      invoices: invoices.map((i) => ({
        _id: i._id,
        number: i.number,
        title: i.title,
        total: i.total,
        amountPaid: i.amountPaid,
        balance: i.balance,
        status: i.status,
        issuedOn: i.issuedOn,
        dueOn: i.dueOn,
        paidAt: i.paidAt,
      })),
      history,
      pending,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That project was not found" });
    }
    console.error("projectPayments error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/admin/project-payments
 *
 * The same question across every project at once — the screen a collections
 * chase is run from, so it is sorted by what is overdue rather than by name.
 */
export const projectPaymentsOverview = async (req, res) => {
  try {
    const query = {};
    if (req.query.client && req.query.client !== "all") query.client = req.query.client;
    if (req.query.status && req.query.status !== "all") query.status = req.query.status;

    const projects = await Project.find(query)
      .select("name code budget client status endDate")
      .populate("client", "name company")
      .sort({ createdAt: -1 })
      .limit(500);

    const rows = await Invoice.aggregate([
      { $match: { project: { $in: projects.map((p) => p._id) }, ...BILLED } },
      {
        $group: {
          _id: "$project",
          invoiced: { $sum: "$total" },
          paid: { $sum: "$amountPaid" },
          outstanding: { $sum: "$balance" },
          invoices: { $sum: 1 },
          /** The earliest thing still owed, which is what a chase starts from. */
          oldestDue: { $min: { $cond: [{ $gt: ["$balance", 0] }, "$dueOn", null] } },
        },
      },
    ]);

    const byProject = rows.reduce((acc, r) => ({ ...acc, [String(r._id)]: r }), {});
    const today = new Date();

    const items = projects.map((project) => {
      const m = byProject[String(project._id)] || {};
      const invoiced = round(m.invoiced);
      const paid = round(m.paid);

      return {
        _id: project._id,
        name: project.name,
        code: project.code,
        status: project.status,
        client: project.client,
        contractValue: round(project.budget),
        invoiced,
        paid,
        outstanding: round(m.outstanding),
        unbilled: round(Math.max(0, (project.budget || 0) - invoiced)),
        invoices: m.invoices || 0,
        oldestDue: m.oldestDue || null,
        overdue: Boolean(m.oldestDue && new Date(m.oldestDue) < today && (m.outstanding || 0) > 0),
        collectedPercent: invoiced ? Math.round((paid / invoiced) * 100) : 0,
      };
    });

    // Overdue first, then by how much is owed — the order a chase is worked in
    items.sort(
      (a, b) => Number(b.overdue) - Number(a.overdue) || b.outstanding - a.outstanding
    );

    const totals = items.reduce(
      (acc, row) => ({
        projects: acc.projects + 1,
        contractValue: round(acc.contractValue + row.contractValue),
        invoiced: round(acc.invoiced + row.invoiced),
        paid: round(acc.paid + row.paid),
        outstanding: round(acc.outstanding + row.outstanding),
        unbilled: round(acc.unbilled + row.unbilled),
        overdueProjects: acc.overdueProjects + (row.overdue ? 1 : 0),
      }),
      {
        projects: 0,
        contractValue: 0,
        invoiced: 0,
        paid: 0,
        outstanding: 0,
        unbilled: 0,
        overdueProjects: 0,
      }
    );

    return res.status(200).json({ items, totals });
  } catch (err) {
    console.error("projectPaymentsOverview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
