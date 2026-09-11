import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Mail, Pencil, Phone, Plus, UserRoundCog } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import useLeaderOptions from "../hooks/useLeaderOptions";
import Avatar from "../../shared/components/Avatar";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import Toolbar from "../../shared/components/Toolbar";
import StaffDetail from "../../shared/staff/StaffDetail";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Select,
} from "../../shared/components/ui";
import { shortDate } from "../../shared/hr/constants";

/**
 * Who works here.
 *
 * HR maintains the record: this reads, edits and hires somebody straight in.
 * Adding used to go through Candidates and Onboarding only, which is right for
 * a vacancy and wrong for the person who starts on Monday with a signed offer.
 *
 * Deleting is still not here, and not because it is hidden: it takes somebody's
 * name off every task and leave they ever touched. Setting them inactive is the
 * reversible answer and is an ordinary edit from this screen.
 */

/**
 * Where hiring and editing happen — the four-step form the admin panel uses,
 * which is the same component. This screen used to carry a shorter one of its
 * own in a modal; two forms writing to one endpoint meant one of them was
 * asking for less than the record holds, and it was this one.
 */
const FORM_PATH = "/hr/employees/add";

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "operations_manager", label: "Operations Manager" },
  { value: "manager", label: "Manager" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
];

/**
 * One of the three tiles above the table.
 *
 * They are counts and they are also the filter: "how many are inactive" and
 * "show me the inactive ones" are the same question asked half a second apart.
 * The one in force is ringed, so the table below is never quietly filtered by
 * something invisible.
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

/**
 * Inside the People panel the heading and the type dropdown belong to the
 * panel, so `embedded` leaves this screen's own PageHeader out and moves its
 * Add button down into the filter bar — one heading on the page, and the
 * button still beside the table it fills.
 */
export default function Employees({ embedded = false }) {
  const { can } = useHrAccess();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  /**
   * The counts and the department list, sent by the server with the page of
   * rows — see buildCrud's `summary`. Counting the rows in hand would describe
   * twenty-five people and call it the company.
   */
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped when the reporting line is changed from a row — the only write
  // this screen still does itself
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");

  // The drawer
  const [viewing, setViewing] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const canCreate = can("employees", "create");
  const canEdit = can("employees", "edit");

  const navigate = useNavigate();

  /**
   * Putting somebody under a manager without opening their whole record.
   *
   * Moving one person between managers is a one-field decision, and walking
   * four steps of a hiring form to make it is why reporting lines go stale.
   * { row, pick } — pick is "" for nobody.
   */
  const [assigning, setAssigning] = useState(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const leaderOptions = useLeaderOptions();

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/employees", {
        params: {
          page,
          search: search || undefined,
          status: status || undefined,
          role: role || undefined,
          department: department || undefined,
        },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
        // Kept from the previous response when one arrives without it, so the
        // tiles do not blink empty between pages
        if (data.summary) setSummary(data.summary);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load people"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [page, search, status, role, department, reloadKey]);

  // One person's full record, only when somebody actually opens them
  useEffect(() => {
    if (!viewing) return undefined;

    let active = true;
    setDetailLoading(true);
    setDetails(null);

    hrApi
      .get(`/hr/employees/${viewing._id}/details`)
      .then(({ data }) => active && setDetails(data))
      .catch(() => active && setDetails(null))
      .finally(() => active && setDetailLoading(false));

    return () => {
      active = false;
    };
  }, [viewing]);


  /* --------------------------------------------------------------- table */

  const contact = (row) => (
    // The address and the number are what anybody copies off this screen, so
    // they are links rather than text to select by hand. The click must not
    // also open the record behind them.
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
  );

  /**
   * The reporting line, on its own.
   *
   * An empty pick is sent as "" rather than left out, because the two mean
   * different things to the server: absent is "do not touch it", empty is
   * "take them off their manager". See the HR people controller.
   */
  const saveManager = async () => {
    setAssignSaving(true);
    try {
      await hrApi.put(`/hr/employees/${assigning.row._id}`, { reportsTo: assigning.pick });
      setAssigning(null);
      setReloadKey((n) => n + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not change that reporting line");
    } finally {
      setAssignSaving(false);
    }
  };

  const actions = (row) => (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setViewing(row)}
        title="View full record"
        aria-label={`View ${row.name}`}
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <Eye size={15} />
      </button>
      {canEdit && (
        <button
          onClick={() => setAssigning({ row, pick: row.reportsTo?._id || "" })}
          title="Change who they report to"
          aria-label={`Change who ${row.name} reports to`}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
        >
          <UserRoundCog size={15} />
        </button>
      )}
      {canEdit && (
        <button
          onClick={() => navigate(`${FORM_PATH}?id=${row._id}`)}
          title="Edit"
          aria-label={`Edit ${row.name}`}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
        >
          <Pencil size={15} />
        </button>
      )}
    </div>
  );

  const columns = [
    {
      key: "name",
      header: "Person",
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
    { key: "email", header: "Contact", render: contact },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge tone="blue">{(row.role || "").replace(/_/g, " ")}</Badge>,
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
    {
      /**
       * Who they answer to, on the list rather than three clicks inside the
       * record. Nobody is drawn in amber rather than as a dash: an employee
       * under no manager is a person whose leave nobody approves and whose
       * report goes nowhere, which is a gap to fill, not a blank to ignore.
       */
      key: "reportsTo",
      header: "Reports to",
      render: (row) =>
        row.reportsTo ? (
          <span className="text-slate-700">{row.reportsTo.name}</span>
        ) : (
          <span className="text-xs text-amber-700">Nobody</span>
        ),
    },
    {
      key: "joiningDate",
      header: "Joined",
      className: "whitespace-nowrap",
      render: (row) => <span className="text-slate-600">{shortDate(row.joiningDate)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "active" ? "blue" : "slate"}>
          {row.status === "active" ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => <div className="flex justify-end">{actions(row)}</div>,
    },
  ];

  /**
   * The same row on a phone. Seven columns do not survive a 390px screen, and
   * a table that has to be dragged sideways to reach Edit is a table nobody
   * edits anything from.
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
          <Badge tone={row.status === "active" ? "blue" : "slate"}>
            {row.status === "active" ? "Active" : "Inactive"}
          </Badge>
        </div>

        <div className="mt-2">{contact(row)}</div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="blue">{(row.role || "").replace(/_/g, " ")}</Badge>
          {row.department && <Badge tone="slate">{row.department}</Badge>}
          <span className="text-[11px] text-slate-400">Joined {shortDate(row.joiningDate)}</span>
          <span
            className={`text-[11px] ${row.reportsTo ? "text-slate-500" : "text-amber-700"}`}
          >
            {row.reportsTo ? `Under ${row.reportsTo.name}` : "No manager"}
          </span>
        </div>

        <div className="mt-2 -ml-1.5">{actions(row)}</div>
      </div>
    </div>
  );

  const filtered = Boolean(search || status || role || department);

  return (
    <div>
      {!embedded && (
        <PageHeader title="Employees" subtitle={`${total} people on record`}>
          {canCreate && (
            <Button onClick={() => navigate(FORM_PATH)}>
              <Plus size={15} /> Add employee
            </Button>
          )}
        </PageHeader>
      )}

      <Alert>{error}</Alert>

      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatTile
            label="Total"
            value={summary.total}
            active={!status}
            onClick={() => {
              setPage(1);
              setStatus("");
            }}
          />
          <StatTile
            label="Active"
            value={summary.active}
            active={status === "active"}
            onClick={() => {
              setPage(1);
              setStatus("active");
            }}
          />
          <StatTile
            label="Inactive"
            value={summary.inactive}
            active={status === "inactive"}
            onClick={() => {
              setPage(1);
              setStatus("inactive");
            }}
          />
        </div>
      )}

      <Card>
        <Toolbar
          search={search}
          onSearch={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Search by name, email, designation or department"
          onFilter={(key, value) => {
            setPage(1);
            if (key === "status") setStatus(value);
            if (key === "role") setRole(value);
            if (key === "department") setDepartment(value);
          }}
          filters={[
            { key: "role", value: role, placeholder: "All roles", options: ROLE_OPTIONS },
            /**
             * The departments that exist, not the ones somebody once listed.
             * Department is a free-text field on the staff forms — a fixed
             * list here would quietly hide everybody in a department typed
             * rather than picked.
             */
            ...(summary?.departments?.length
              ? [
                  {
                    key: "department",
                    value: department,
                    placeholder: "All departments",
                    options: summary.departments,
                  },
                ]
              : []),
            {
              key: "status",
              value: status,
              placeholder: "Any status",
              options: [
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ],
            },
          ]}
        >
          {/* Embedded, this is the only Add button on the screen — the People
              panel's own header carries the type dropdown instead */}
          {embedded && canCreate && (
            <Button size="sm" className="ml-auto" onClick={() => navigate(FORM_PATH)}>
              <Plus size={15} /> Add employee
            </Button>
          )}
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          page={page}
          pages={pages}
          total={total}
          onPageChange={setPage}
          onRowClick={setViewing}
          renderCard={renderCard}
          emptyTitle={filtered ? "Nobody matches that" : "Nobody here yet"}
          emptyMessage={
            filtered
              ? "Try a different search, or clear the filters above."
              : "Add somebody, or bring them through Hiring."
          }
        />
      </Card>

      <p className="mt-3 text-xs text-slate-500">
        Closing an account for good is an administrator's action — from here, somebody who has
        left is set inactive, which keeps everything their name is on.
      </p>

      {/* ---------------------------------------------------- the drawer */}
      {/**
       * The whole record, in the shared staff screen.
       *
       * The admin panel shows the same component against its own /details
       * response — one screen for one kind of record, so the two panels
       * cannot drift into showing different things about the same person.
       * HR has no chat, so no chatPath is passed and the Chat button is
       * left out rather than linking somewhere that does not exist.
       */}
      <StaffDetail
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        data={details}
        loading={detailLoading}
        /**
         * These two are what switch the Salary tab on — the tab loads and
         * writes on its own rather than through the /details payload, so it
         * needs the panel's own client and prefix. HR gets them because
         * payroll is HR's: they set the rate and they record what was paid,
         * and /api/hr/staff/:id/salary has been answering them all along.
         *
         * No chatPath — the HR panel has no chat to send anybody to, and the
         * Chat button is left out rather than linking nowhere.
         */
        api={hrApi}
        basePath="/hr"
        /**
         * HR files every staff document under one route, whatever the role —
         * so the scans in the Documents tab open from here.
         */
        docPath={(id, field) => `/hr/documents/${id}/${field}`}
      />


      {/* ------------------------------------------- who they report to */}
      <Modal
        open={Boolean(assigning)}
        title="Who do they report to?"
        subtitle={assigning?.row?.name}
        size="sm"
        onClose={() => setAssigning(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssigning(null)} disabled={assignSaving}>
              Cancel
            </Button>
            <Button onClick={saveManager} disabled={assignSaving}>
              {assignSaving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {assigning && (
          <div className="space-y-3">
            <Field label="Manager">
              <Select
                value={assigning.pick}
                onChange={(e) =>
                  setAssigning((current) => ({ ...current, pick: e.target.value }))
                }
                options={[{ value: "", label: "Nobody — take them off their manager" }, ...leaderOptions]}
                disabled={assignSaving}
              />
            </Field>

            <p className="text-xs text-slate-500">
              {assigning.row.reportsTo
                ? `Right now they report to ${assigning.row.reportsTo.name}.`
                : "Right now nobody is above them."}{" "}
              This is the line their reports travel up and their leave is approved along.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
