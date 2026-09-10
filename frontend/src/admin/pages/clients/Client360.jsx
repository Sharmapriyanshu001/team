import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  FolderKanban,
  Handshake,
  History,
  IndianRupee,
  Phone,
  Plus,
  Send,
  Users,
} from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import usePermissions from "../../hooks/usePermissions";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
  Textarea,
} from "../../../shared/components/ui";

/**
 * One client, seen from every department at once.
 *
 * The panel could already answer each half separately — Sales knew the lead
 * and the invoices, Operations knew the projects and the tasks — and nobody
 * could see the join. This is the join: where they came from, what was sold,
 * who is delivering it, and what is still owed.
 *
 * Everything is assembled by the server on read from the records themselves.
 * There is no stored summary behind it, which is what stops it going quietly
 * stale.
 */

const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const longDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/** Which department an event came from, so the timeline reads at a glance. */
const DEPARTMENT_DOTS = {
  sales: "bg-blue-500",
  operations: "bg-emerald-500",
};

const Metric = ({ icon: Icon, label, value, hint }) => (
  <Card>
    <div className="flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate text-lg font-bold text-slate-900">{value}</p>
        {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  </Card>
);

export default function Client360() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { operationsStaff } = useLookups();
  const { can } = usePermissions();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [handingOver, setHandingOver] = useState(false);
  const [handover, setHandover] = useState({ accountManager: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    adminApi
      .get(`/admin/clients/${id}/360`)
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load this client")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const submitHandover = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await adminApi.put(`/admin/clients/${id}/handover`, handover);
      setHandingOver(false);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not record the handover");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Loader label="Loading client…" />;
  if (error && !data) {
    return (
      <div>
        <Alert>{error}</Alert>
        <Button variant="outline" onClick={() => navigate("/admin/clients")}>
          <ArrowLeft size={15} />
          Back to clients
        </Button>
      </div>
    );
  }

  const { client, sales, handover: done, operations, files, meetings, timeline, stats } = data;
  const staffOptions = (operationsStaff || []).map((person) => ({
    value: person._id,
    label: person.designation ? `${person.name} — ${person.designation}` : person.name,
  }));

  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={
          [client.company, client.email, client.phone].filter(Boolean).join(" · ") ||
          "No contact details on file"
        }
      >
        <Button variant="outline" onClick={() => navigate("/admin/clients")}>
          <ArrowLeft size={15} />
          All Clients
        </Button>
        {can("clients", "edit") && (
          <Button
            onClick={() => {
              setHandover({
                accountManager: done.accountManager?._id || "",
                note: done.note || "",
              });
              setFormError("");
              setHandingOver(true);
            }}
          >
            <Send size={15} />
            {done.done ? "Reassign" : "Hand to Operations"}
          </Button>
        )}
      </PageHeader>

      <Alert>{error}</Alert>

      {/* ------------------------------------------------------- the numbers */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={IndianRupee}
          label="Invoiced"
          value={money(sales.money.invoiced)}
          hint={`${money(sales.money.received)} received`}
        />
        <Metric
          icon={IndianRupee}
          label="Outstanding"
          value={money(sales.money.outstanding)}
          hint={`${sales.invoices.length} invoice${sales.invoices.length === 1 ? "" : "s"}`}
        />
        <Metric
          icon={FolderKanban}
          label="Projects"
          value={stats.projects}
          hint={`${stats.projectsActive} active · ${stats.projectsCompleted} delivered`}
        />
        <Metric
          icon={Users}
          label="Team on it"
          value={stats.teamSize}
          hint={`${operations.tasks.total} tasks · ${operations.issues.open} open issues`}
        />
      </div>

      {/* ---------------------------------------------- the handover banner */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                done.done ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
              }`}
            >
              <Handshake size={17} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {done.done ? "With Operations" : "Not yet handed over"}
              </p>
              <p className="text-xs text-slate-500">
                {done.done
                  ? `${done.accountManager?.name || "Somebody"} took this on ${longDate(done.at)}${
                      done.by?.name ? `, from ${done.by.name}` : ""
                    }`
                  : "Sales still holds this client — nobody in Operations has picked it up."}
              </p>
              {done.note && <p className="mt-1 text-xs text-slate-400">“{done.note}”</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Sales owner:</span>
            <Badge tone="blue">{sales.owner?.name || "Unassigned"}</Badge>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------------- the lead */}
        <Card>
          <CardHeader title="Where this came from" subtitle="The sales history" />
          {sales.lead ? (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge value={sales.lead.stage} />
                <span className="text-xs text-slate-400">{longDate(sales.lead.createdAt)}</span>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Source</dt>
                  <dd className="text-right capitalize text-slate-900">
                    {(sales.lead.source || "—").replace(/_/g, " ")}
                    {sales.lead.sourceDetail ? ` · ${sales.lead.sourceDetail}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Estimated value</dt>
                  <dd className="text-slate-900">{money(sales.lead.estimatedValue)}</dd>
                </div>
                {sales.lead.wonAt && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Won on</dt>
                    <dd className="text-slate-900">{longDate(sales.lead.wonAt)}</dd>
                  </div>
                )}
              </dl>

              {sales.lead.requirement && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {sales.lead.requirement}
                </p>
              )}

              {sales.lead.notes?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    What was said
                  </p>
                  <ul className="space-y-2">
                    {sales.lead.notes.slice(-4).reverse().map((note) => (
                      <li key={note._id} className="border-l-2 border-slate-200 pl-2.5">
                        <p className="text-xs text-slate-700">{note.body}</p>
                        <p className="text-[11px] text-slate-400">
                          {note.byName || "Someone"} · {longDate(note.at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Link
                to="/admin/crm/leads"
                className="inline-block text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Open in the pipeline →
              </Link>
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title="Added by hand"
              message="This client did not come through the sales pipeline, so there is no lead behind it."
            />
          )}

          {/**
           * Work we already did for them, answered once when the client was
           * added. Sits under the sales history because it is the same
           * question — where this client came from — asked of delivery rather
           * than of the pipeline.
           */}
          {client.previousProject && (
            <div className="border-t border-slate-100 p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <History size={12} />
                Returning client
              </p>
              <p className="text-sm text-slate-900">
                {client.previousProject.code ? `${client.previousProject.code} · ` : ""}
                {client.previousProject.name}
              </p>
              <p className="text-xs text-slate-400">
                {client.previousProject.status?.replace(/_/g, " ")}
                {client.previousProject.endDate
                  ? ` · delivered ${longDate(client.previousProject.endDate)}`
                  : ""}
              </p>
              <p className="mt-1.5 text-[11px] text-slate-500">
                New projects for this client are linked to it automatically.
              </p>
            </div>
          )}
        </Card>

        {/* --------------------------------------------------- the projects */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Delivery"
            subtitle={`${operations.progress}% average progress across ${stats.projects} project${
              stats.projects === 1 ? "" : "s"
            }`}
            action={
              /**
               * Opening a project from the client you are already looking at,
               * with the client filled in. The alternative is finding the same
               * name again in a dropdown of every client on the books, which
               * is how a project ends up filed against the wrong one.
               */
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/admin/projects/create?client=${id}`)}
              >
                <Plus size={13} /> Create project
              </Button>
            }
          />
          {operations.projects.length ? (
            <ul className="divide-y divide-slate-100">
              {operations.projects.map((project) => (
                <li key={project._id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{project.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {project.code || "—"}
                        {project.operationsManager ? ` · led by ${project.operationsManager.name}` : ""}
                        {project.members?.length ? ` · ${project.members.length} on it` : ""}
                      </p>
                      {/* What this job continues from, where there is one */}
                      {project.previousProject && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                          <History size={11} className="shrink-0" />
                          Continues from {project.previousProject.code || ""}{" "}
                          {project.previousProject.name}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <ProgressBar value={project.progress || 0} />
                      <Badge value={project.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              message={
                done.done
                  ? "Operations has this client but has not started anything."
                  : "Nothing has been started — this client has not reached Operations."
              }
            />
          )}
        </Card>

        {/* ------------------------------------------------------- the money */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Quotations & invoices"
            subtitle={`${money(sales.money.quoted)} quoted · ${money(
              sales.money.invoiced
            )} invoiced · ${money(sales.money.outstanding)} outstanding`}
          />
          {sales.quotations.length || sales.invoices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <tbody>
                  {sales.quotations.map((quote) => (
                    <tr key={quote._id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] uppercase tracking-wide text-slate-400">
                          Quotation
                        </span>
                        <p className="font-medium text-slate-900">{quote.number || "—"}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{quote.title || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge value={quote.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                        {money(quote.total)}
                      </td>
                    </tr>
                  ))}
                  {sales.invoices.map((invoice) => (
                    <tr key={invoice._id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] uppercase tracking-wide text-slate-400">
                          Invoice
                        </span>
                        <Link
                          to={`/admin/crm/invoices/${invoice._id}`}
                          className="block font-medium text-blue-600 hover:text-blue-700"
                        >
                          {invoice.number || "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{invoice.title || "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge value={invoice.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <p className="font-medium text-slate-900">{money(invoice.total)}</p>
                        {invoice.balance > 0 && (
                          <p className="text-[11px] text-red-600">{money(invoice.balance)} due</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={IndianRupee}
              title="Nothing billed yet"
              message="Quotations and invoices raised for this client show up here."
            />
          )}
        </Card>

        {/* ------------------------------------------------------ the people */}
        <Card>
          <CardHeader title="Who is on it" subtitle="Across every project" />
          {operations.team.length ? (
            <ul className="divide-y divide-slate-100">
              {operations.team.map((person) => (
                <li key={person._id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{person.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {person.designation || person.role?.replace(/_/g, " ") || "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Users} title="Nobody assigned" />
          )}
        </Card>

        {/* ----------------------------------------------------- the timeline */}
        <Card className="lg:col-span-3">
          <CardHeader
            title="Everything that happened"
            subtitle="Sales and Operations on one timeline, newest first"
          />
          {timeline?.length ? (
            <ol className="p-4">
              {timeline.map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex gap-3 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        DEPARTMENT_DOTS[event.department] || "bg-slate-400"
                      }`}
                    />
                    {index < timeline.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-slate-200" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{event.title}</p>
                      <span className="text-[11px] text-slate-400">{longDate(event.at)}</span>
                    </div>
                    {event.detail && <p className="text-xs text-slate-500">{event.detail}</p>}
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                      {event.department}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={Handshake} title="Nothing recorded yet" />
          )}
        </Card>

        {/* -------------------------------------------------- files & meetings */}
        <Card className="lg:col-span-2">
          <CardHeader title="Files" subtitle={`${stats.files} on file`} />
          {files?.length ? (
            <ul className="divide-y divide-slate-100">
              {files.map((file) => (
                <li key={file._id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{file.title}</p>
                    <p className="truncate text-xs text-slate-400">
                      {file.category || "—"}
                      {file.project ? ` · ${file.project.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{longDate(file.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Building2} title="No files yet" />
          )}
        </Card>

        <Card>
          <CardHeader title="Meetings" subtitle={`${meetings?.length || 0} on record`} />
          {meetings?.length ? (
            <ul className="divide-y divide-slate-100">
              {meetings.map((meeting) => (
                <li key={meeting._id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-slate-900">{meeting.title}</p>
                    <Badge value={meeting.status} />
                  </div>
                  <p className="text-xs text-slate-400">{longDate(meeting.scheduledAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Phone} title="No meetings yet" />
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------- handover */}
      <Modal
        open={handingOver}
        onClose={() => setHandingOver(false)}
        title={done.done ? "Reassign this client" : "Hand over to Operations"}
        subtitle="Whoever takes it on is told, and their name goes on the record"
        footer={
          <>
            <Button variant="outline" onClick={() => setHandingOver(false)}>
              Cancel
            </Button>
            <Button onClick={submitHandover} loading={saving}>
              {done.done ? "Reassign" : "Hand over"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitHandover} className="space-y-3">
          <Alert>{formError}</Alert>

          <Field label="Who is taking this on" required>
            <Select
              value={handover.accountManager}
              onChange={(e) => setHandover({ ...handover, accountManager: e.target.value })}
              options={staffOptions}
              placeholder="Choose from Operations"
              required
            />
          </Field>

          <Field label="Note" hint="What they need to know to pick this up">
            <Textarea
              rows={3}
              value={handover.note}
              onChange={(e) => setHandover({ ...handover, note: e.target.value })}
              placeholder="Kickoff next Monday, scope is in the quotation"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
