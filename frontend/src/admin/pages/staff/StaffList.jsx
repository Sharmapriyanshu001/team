import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Mail, Phone, Eye } from "lucide-react";

import adminApi from "../../adminApi";
import { useCrud } from "../../hooks/crud";
import StaffDetail from "../../../shared/staff/StaffDetail";
import Avatar from "../../../shared/components/Avatar";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card, PageHeader } from "../../../shared/components/ui";

/**
 * Dates as a person reads them.
 *
 * "11/10/2025" is the 11th of October here and the 10th of November to half
 * the people who might open this panel, and a joining date is exactly the
 * field somebody reads carefully. Spelling the month costs three characters
 * and removes the question.
 */
const joinedOn = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * One of the three tiles above the table.
 *
 * They are counts and they are also the filter: "how many are inactive" and
 * "show me the inactive ones" are the same question asked half a second apart,
 * and making somebody read the number here and then find the same word in a
 * dropdown is a step for nothing. The one in force is ringed, so the table
 * underneath is never quietly filtered by something invisible.
 */
function StatTile({ label, value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-colors ${
        active
          ? "border-blue-600 ring-1 ring-blue-600"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
    </button>
  );
}

/** The three buttons on every row, on the table and on the cards alike. */
function RowActions({ onView, onEdit, onDelete, name }) {
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={onView}
        title="View full details"
        aria-label={`View ${name}`}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <Eye size={15} />
      </button>
      <button
        onClick={onEdit}
        title="Edit"
        aria-label={`Edit ${name}`}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
      >
        <Pencil size={15} />
      </button>
      <button
        onClick={onDelete}
        title="Delete"
        aria-label={`Delete ${name}`}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/**
 * Shared list screen for the managers, operations managers and employees lists.
 *
 * It has two homes. On its own page it draws its heading and its Add button
 * like any other screen; inside the Team & Accounts panel — where the heading
 * and the type dropdown belong to the panel — `embedded` leaves the heading
 * out and moves Add into the toolbar, so the page never carries two titles.
 *
 * `editPath` exists for the same reason: the panel keeps its list and its form
 * on one URL told apart by query parameters, so "edit this person" is not
 * always the list path with "?id=" glued to the end.
 */
export default function StaffList({
  resource,
  title,
  subtitle,
  addPath,
  editPath,
  addLabel = "Add",
  embedded = false,
  showOperationsManager,
}) {
  const navigate = useNavigate();
  const crud = useCrud(resource);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Row that is open in the profile drawer
  const [viewing, setViewing] = useState(null);

  /**
   * The full record, fetched only when somebody actually opens a person.
   *
   * The list already carries enough for the table; everything else — their
   * documents, bank, projects and login — is a second query nobody should pay
   * for while they are only scrolling.
   */
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!viewing) return undefined;

    let active = true;
    setDetailLoading(true);
    setDetails(null);

    adminApi
      .get(`/admin/${resource}/${viewing._id}/details`)
      .then(({ data }) => active && setDetails(data))
      .catch(() => active && setDetails(null))
      .finally(() => active && setDetailLoading(false));

    return () => {
      active = false;
    };
  }, [viewing, resource]);

  /**
   * The counts and the department list come from the server with the page of
   * rows — see buildCrud's `summary`. Counting the rows in hand instead would
   * describe twenty-five people and call it the company.
   */
  const summary = crud.summary;
  const status = crud.filters.status || "";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete this record");
    } finally {
      setDeleting(false);
    }
  };

  const openProfile = (row) => setViewing(row);
  const editHref = (id) => (editPath ? editPath(id) : `${addPath}?id=${id}`);
  const openEdit = (row) => navigate(editHref(row._id));

  const actionsFor = (row) => ({
    name: row.name,
    onView: () => openProfile(row),
    onEdit: () => openEdit(row),
    onDelete: () => setTarget(row),
  });

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-500">{row.designation || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Contact",
      render: (row) => (
        // The address and the number are the two things anybody copies off this
        // screen, so they are links rather than text to be selected by hand.
        // The click must not also open the profile drawer behind them.
        <div className="space-y-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
          <a
            href={`mailto:${row.email}`}
            className="flex items-center gap-1.5 text-slate-700 hover:text-blue-600 hover:underline"
          >
            <Mail size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{row.email}</span>
          </a>
          {row.phone ? (
            <a
              href={`tel:${row.phone}`}
              className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 hover:underline"
            >
              <Phone size={12} className="shrink-0 text-slate-400" />
              {row.phone}
            </a>
          ) : (
            <p className="flex items-center gap-1.5 text-slate-400">
              <Phone size={12} className="shrink-0 text-slate-300" />—
            </p>
          )}
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (row) =>
        row.department ? (
          <Badge tone="slate">{row.department}</Badge>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    ...(showOperationsManager
      ? [
          {
            key: "reportsTo",
            header: "Reports to",
            render: (row) =>
              row.reportsTo?.name ? (
                <span className="text-slate-700">{row.reportsTo.name}</span>
              ) : (
                // Not a blank: nobody can give this person work until somebody
                // fixes it, and that is worth reading as a gap
                <span className="text-xs text-slate-400">Not assigned</span>
              ),
          },
        ]
      : []),
    {
      key: "joiningDate",
      header: "Joined",
      className: "whitespace-nowrap",
      render: (row) => <span className="text-slate-600">{joinedOn(row.joiningDate)}</span>,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      // Stop the click bubbling, otherwise the row also opens the profile
      render: (row) => (
        <div className="flex justify-end">
          <RowActions {...actionsFor(row)} />
        </div>
      ),
    },
  ];

  /**
   * The same row on a phone. Seven columns do not survive a 390px screen, and
   * a table that has to be dragged sideways to reach the Edit button is a
   * table nobody edits anything from.
   */
  const renderCard = (row) => (
    <div className="flex items-start gap-3">
      <Avatar name={row.name} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-500">{row.designation || "—"}</p>
          </div>
          <Badge value={row.status} />
        </div>

        <div className="mt-2 space-y-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
          <a
            href={`mailto:${row.email}`}
            className="flex items-center gap-1.5 text-slate-700 hover:text-blue-600"
          >
            <Mail size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{row.email}</span>
          </a>
          {row.phone && (
            <a
              href={`tel:${row.phone}`}
              className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600"
            >
              <Phone size={12} className="shrink-0 text-slate-400" />
              {row.phone}
            </a>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {row.department && <Badge tone="slate">{row.department}</Badge>}
          <span className="text-[11px] text-slate-400">Joined {joinedOn(row.joiningDate)}</span>
          {showOperationsManager && (
            <span className="text-[11px] text-slate-400">
              · {row.reportsTo?.name || "Not assigned"}
            </span>
          )}
        </div>

        <div className="mt-2 -ml-1.5">
          <RowActions {...actionsFor(row)} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {!embedded && (
        <PageHeader title={title} subtitle={subtitle || `${crud.total} people on record`}>
          <Link to={addPath}>
            <Button>
              <Plus size={15} />
              {addLabel}
            </Button>
          </Link>
        </PageHeader>
      )}

      <Alert>{crud.error}</Alert>

      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatTile
            label="Total"
            value={summary.total}
            active={!status}
            onClick={() => crud.setFilter("status", "")}
          />
          <StatTile
            label="Active"
            value={summary.active}
            active={status === "active"}
            onClick={() => crud.setFilter("status", "active")}
          />
          <StatTile
            label="Inactive"
            value={summary.inactive}
            active={status === "inactive"}
            onClick={() => crud.setFilter("status", "inactive")}
          />
        </div>
      )}

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name, email, designation or department"
          onFilter={crud.setFilter}
          filters={[
            /**
             * The departments that exist, not the ones somebody once listed.
             * Department is a free-text field on the staff form — a fixed list
             * here would quietly hide everybody in a department typed rather
             * than picked.
             */
            ...(summary?.departments?.length
              ? [
                  {
                    key: "department",
                    value: crud.filters.department,
                    placeholder: "All departments",
                    options: summary.departments,
                  },
                ]
              : []),
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: ["active", "inactive"],
            },
          ]}
        >
          {/* Embedded, this is the only Add button on the screen — the panel's
              own header carries the type dropdown instead */}
          {embedded && (
            <Link to={addPath} className="ml-auto">
              <Button size="sm">
                <Plus size={15} />
                {addLabel}
              </Button>
            </Link>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={openProfile}
          renderCard={renderCard}
          emptyTitle={
            crud.search || status || crud.filters.department ? "Nobody matches that" : "Nobody here yet"
          }
          emptyMessage={
            crud.search || status || crud.filters.department
              ? "Try a different search, or clear the filters above."
              : "Add team members to assign them to projects and tasks."
          }
        />
      </Card>

      {/**
        * The whole record, in the shared staff screen — the same component the
        * HR panel uses, so one kind of record has one screen.
        *
        * Fetched here rather than inside it: HR already fetched its own copy
        * before rendering, and a presenter that also fetches would have two
        * ways to be given data and one of them wrong.
        */}
      <StaffDetail
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        data={details}
        loading={detailLoading}
        api={adminApi}
        basePath="/admin"
        chatPath={
          /**
           * Only employees have a chat room in the admin panel, and the room
           * id is the person's own id — so this lands on their conversation
           * rather than on whoever is first in the list.
           */
          viewing && resource === "employees"
            ? `/admin/chat/employees?room=${viewing._id}`
            : undefined
        }
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete record"
        message={`Delete "${target?.name}"? Their tasks will stay but become unassigned.`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
