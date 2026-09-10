import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Pencil, Phone } from "lucide-react";

import adminApi from "../../adminApi";
import Avatar from "../../../shared/components/Avatar";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import { Alert, Badge, Card } from "../../../shared/components/ui";

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

export default function AllPeople({ sources, hrefFor }) {
  const [rows, setRows] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

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

  /** Opens whichever screen actually owns this record. */
  const EditLink = ({ row }) => (
    <Link
      to={hrefFor(row)}
      title={`Open ${row.name}`}
      aria-label={`Open ${row.name}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      <Pencil size={15} />
    </Link>
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
      render: (row) => <Badge tone="sky">{row.source.label}</Badge>,
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
          <EditLink row={row} />
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
          <Badge tone="sky">{row.source.label}</Badge>
          {row.department && <Badge tone="slate">{row.department}</Badge>}
        </div>

        <div className="mt-2 -ml-1.5">
          <EditLink row={row} />
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
        />
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
    </div>
  );
}
