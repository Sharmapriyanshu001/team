import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";

import adminApi from "../../adminApi";
import ProfileDetail from "../../components/ProfileDetail";
import StaffDetail from "../../../shared/staff/StaffDetail";
import Avatar from "../../../shared/components/Avatar";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { ConfirmDialog } from "../../../shared/components/Modal";
import { Alert, Badge, Button, Card } from "../../../shared/components/ui";

/**
 * Everybody with a login, in one table.
 *
 * The dropdown on this panel asks which kind of person, and until now every
 * answer was one kind. "All" answers the question that was missing: somebody
 * has half a name or an email address and does not yet know whether it belongs
 * to an employee, a manager, an HR login or a client — which is exactly the
 * moment when being asked to pick the type first is the wrong question.
 *
 * There is no single endpoint behind this. Staff, department logins and
 * clients are three different lists with three different shapes, and this
 * fetches the ones the account is allowed to see and merges them rather than
 * teaching the server a seventh way to describe a person. Each row remembers
 * which list it came from, so Edit still opens the screen that owns the
 * record.
 *
 * Searching, filtering and paging happen here rather than on the server for
 * the same reason: one page of a merged list is not a page of anything the
 * server holds.
 */

const PER_PAGE = 25;

/**
 * buildCrud caps a page at 200 rows. Ten of those is far more people than this
 * view is useful for, and the ceiling stops one dropdown choice from turning
 * into an unbounded number of requests on a very large company.
 */
const FETCH_LIMIT = 200;
const MAX_REQUESTS = 10;

/** Every page of one list, and whether it had to stop before the end. */
const fetchAll = async (source) => {
  const rows = [];

  for (let page = 1; page <= MAX_REQUESTS; page += 1) {
    const { data } = await adminApi.get(source.path, {
      params: { ...source.params, page, limit: FETCH_LIMIT },
    });

    const items = data.items || [];
    rows.push(...items.map((item) => ({ ...item, source })));

    /**
     * The department-accounts list answers in one go and ignores paging
     * altogether, so it finishes here on the first pass.
     */
    if (!items.length || rows.length >= (data.total ?? rows.length)) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
};

/**
 * A person reads a designation; a client has a company instead. Whichever of
 * the two this record carries is the line under the name.
 */
const subtitleOf = (row) => row.designation || row.company || "";

/**
 * The kind of person, and for staff the department they are in.
 *
 * A merged list is read type-first — "which of these are employees" — and the
 * answer to that is very often followed by "in which team". The Department
 * column already carries it, but the two questions were a column apart, so
 * scanning for one department meant reading across every row. Clients and the
 * department logins carry no department of their own and read as they did.
 */
const typeLabelOf = (row) =>
  row.department ? `${row.source.label} (${row.department})` : row.source.label;

export default function AllPeople({ sources, hrefFor, addPath = "" }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  // The row open in the profile drawer, and the one waiting on a confirmation
  const [viewing, setViewing] = useState(null);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * Which of the two drawers the open row belongs to.
   *
   * Staff read through the tabbed profile and clients through their own, so
   * the row decides which one opens rather than this screen inventing a third.
   */
  const staffView = viewing?.source.detail?.kind === "staff" ? viewing : null;
  const clientView = viewing?.source.detail?.kind === "client" ? viewing : null;

  /**
   * The full staff record, fetched only once somebody opens one.
   *
   * The client drawer fetches its own; the staff one is a presenter and is
   * handed its data, exactly as the employees list hands it over — so one kind
   * of record still has one screen behind it.
   */
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!staffView) return undefined;

    let active = true;
    setDetailLoading(true);
    setDetails(null);

    adminApi
      .get(`/admin/${staffView.source.detail.resource}/${staffView._id}/details`)
      .then(({ data }) => active && setDetails(data))
      .catch(() => active && setDetails(null))
      .finally(() => active && setDetailLoading(false));

    return () => {
      active = false;
    };
  }, [staffView]);

  /**
   * The array itself is rebuilt every time the panel above renders. What
   * decides whether to fetch again is which lists it names, not its identity.
   */
  const key = sources.map((source) => source.value).join(",");

  useEffect(() => {
    let active = true;

    /**
     * Settled rather than all: six lists behind one choice means six ways to
     * fail, and one of them refusing is not a reason to show none of the other
     * five. What did not load is named instead of quietly missing.
     */
    Promise.allSettled(sources.map(fetchAll))
      .then((results) => {
        if (!active) return;

        const done = results.filter((result) => result.status === "fulfilled");
        const missing = sources.filter((_, i) => results[i].status === "rejected");

        setRows(done.flatMap((result) => result.value.rows));
        setTruncated(done.some((result) => result.value.truncated));
        setError(
          missing.length
            ? `Could not load ${missing.map((source) => source.label).join(", ")}. Everyone else is listed below.`
            : ""
        );
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * Counted before the filters rather than after, so the tiles keep saying how
   * many people there are while somebody narrows the table underneath.
   */
  const counts = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((row) => (row.status || "active") === "active").length;
    return { total, active, inactive: total - active };
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return rows
      .filter((row) => !type || row.source.value === type)
      .filter((row) => !status || (row.status || "active") === status)
      .filter(
        (row) =>
          !term ||
          [row.name, row.email, row.phone, row.designation, row.company, row.department].some(
            (field) => String(field || "").toLowerCase().includes(term)
          )
      )
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [rows, search, status, type]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  // A filter can leave fewer pages than the one being looked at
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const narrowed = Boolean(search || type || status);

  const onSearch = (value) => {
    setPage(1);
    setSearch(value);
  };

  const onFilter = (field, value) => {
    setPage(1);
    if (field === "type") setType(value);
    if (field === "status") setStatus(value);
  };

  /**
   * Deleting off the merged list.
   *
   * Every row remembers the list it came from, so this deletes against that
   * list's own endpoint — there is no combined one to delete from. The row is
   * dropped from the rows in hand rather than refetching all of them for one
   * removal, and the tiles above count that same array, so they follow.
   */
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await adminApi.delete(`${target.source.path}/${target._id}`);
      setRows((current) =>
        current.filter(
          (row) => row._id !== target._id || row.source.value !== target.source.value
        )
      );
      setTarget(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete this record");
    } finally {
      setDeleting(false);
    }
  };

  /**
   * The same three actions the single-type lists carry, on the merged one.
   *
   * View is the one that is not always there: it opens a record's own profile,
   * and a Sales or HR login has no profile endpoint behind it. Those rows show
   * Edit and Delete rather than an eye that would lead nowhere.
   *
   * Edit stays a Link because it navigates — it opens whichever screen owns
   * the record, which is the whole reason a row remembers its source.
   */
  const RowActions = ({ row }) => (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {row.source.detail && (
        <button
          type="button"
          onClick={() => setViewing(row)}
          title="View full details"
          aria-label={`View ${row.name}`}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <Eye size={15} />
        </button>
      )}
      <Link
        to={hrefFor(row)}
        title="Edit"
        aria-label={`Edit ${row.name}`}
        className="inline-flex rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
      >
        <Pencil size={15} />
      </Link>
      <button
        type="button"
        onClick={() => setTarget(row)}
        title="Delete"
        aria-label={`Delete ${row.name}`}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-500">{subtitleOf(row) || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge tone="sky">{typeLabelOf(row)}</Badge>,
    },
    {
      key: "email",
      header: "Contact",
      render: (row) => (
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
    { key: "status", header: "Status", render: (row) => <Badge value={row.status || "active"} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end">
          <RowActions row={row} />
        </div>
      ),
    },
  ];

  /** The same row on a phone, where six columns do not fit. */
  const renderCard = (row) => (
    <div className="flex items-start gap-3">
      <Avatar name={row.name} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.name}</p>
            <p className="truncate text-xs text-slate-500">{subtitleOf(row) || "—"}</p>
          </div>
          <Badge value={row.status || "active"} />
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
          <Badge tone="sky">{typeLabelOf(row)}</Badge>
        </div>

        <div className="mt-2 -ml-1.5">
          <RowActions row={row} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <Alert>{error}</Alert>

      {/* Said out loud rather than quietly dropped: a table that stops short
          without mentioning it is worse than a longer wait would have been */}
      <Alert tone="success">
        {truncated
          ? "There are more people than this combined view loads at once. Pick a single type above to see all of them."
          : ""}
      </Alert>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: counts.total, filter: "" },
          { label: "Active", value: counts.active, filter: "active" },
          { label: "Inactive", value: counts.inactive, filter: "inactive" },
        ].map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => onFilter("status", tile.filter)}
            aria-pressed={status === tile.filter}
            className={`rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-colors ${
              status === tile.filter
                ? "border-blue-600 ring-1 ring-blue-600"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <p className="text-xs text-slate-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {loading ? "—" : tile.value}
            </p>
          </button>
        ))}
      </div>

      <Card>
        <Toolbar
          search={search}
          onSearch={onSearch}
          searchPlaceholder="Search everybody by name, email, phone, designation or company"
          onFilter={onFilter}
          filters={[
            {
              key: "type",
              value: type,
              placeholder: "All types",
              options: sources.map((source) => ({ value: source.value, label: source.label })),
            },
            {
              key: "status",
              value: status,
              placeholder: "All statuses",
              options: ["active", "inactive"],
            },
          ]}
        >
          {/* The same Add button every other list on this panel carries */}
          {addPath && (
            <Link to={addPath} className="ml-auto">
              <Button size="sm">
                <Plus size={15} />
                Add candidate
              </Button>
            </Link>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          page={current}
          pages={pages}
          total={filtered.length}
          onPageChange={setPage}
          renderCard={renderCard}
          emptyTitle={narrowed ? "Nobody matches that" : "Nobody here yet"}
          emptyMessage={
            narrowed
              ? "Try a different search, or clear the filters above."
              : "Add employees, managers or clients and they will all show up here."
          }
        />
      </Card>

      {/**
        * Both drawers, each opening for the rows it owns — the same two screens
        * the single-type lists open, so a person opened from All reads exactly
        * as they read from their own list.
        */}
      <StaffDetail
        open={Boolean(staffView)}
        onClose={() => setViewing(null)}
        data={details}
        loading={detailLoading}
        api={adminApi}
        basePath="/admin"
        /**
         * The resource comes off the opened row rather than being fixed, since
         * this list mixes employees, managers and operations managers and each
         * serves its documents from its own prefix.
         */
        docPath={(id, field) =>
          `/admin/${staffView?.source.detail.resource}/${id}/documents/${field}`
        }
        chatPath={
          /**
           * Only employees have a chat room in this panel, and the room id is
           * the person's own id.
           */
          staffView?.source.detail.resource === "employees"
            ? `/admin/chat/employees?room=${staffView._id}`
            : undefined
        }
      />

      <ProfileDetail
        open={Boolean(clientView)}
        resource={clientView?.source.detail.resource}
        id={clientView?._id}
        roleLabel={clientView?.source.label}
        onClose={() => setViewing(null)}
        onEdit={() => clientView && navigate(hrefFor(clientView))}
      />

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete record"
        message={`Delete "${target?.name}"? Their login goes with them, and this cannot be undone.`}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
