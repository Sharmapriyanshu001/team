import { useCallback, useEffect, useState } from "react";
import { Eye, KeyRound, Mail, Pencil, Phone, Plus } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import Avatar from "../../shared/components/Avatar";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal from "../../shared/components/Modal";
import StaffDetail from "../../shared/staff/StaffDetail";
import OnboardingFields from "../components/OnboardingFields";
import { BLANK_PAPERWORK, paperworkProblems } from "../components/onboarding";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";
import { shortDate } from "../../shared/hr/constants";
import { DEFAULT_PASSWORD } from "../../shared/staffPassword";

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

/** A blank hire. The starting password is used unless one is typed. */
const BLANK = {
  name: "",
  email: "",
  phone: "",
  designation: "",
  department: "",
  status: "active",
  joiningDate: "",
  reportsTo: "",
  address: "",
  password: "",
  ...BLANK_PAPERWORK,
};

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "operations_manager", label: "Operations Manager" },
  { value: "manager", label: "Manager" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
];

const STEPS = [
  { title: "Who they are", blurb: "Their details, and what they sign in with" },
  { title: "Documents and bank", blurb: "Aadhaar, PAN and where the salary is paid" },
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
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");

  // The drawer
  const [viewing, setViewing] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [editing, setEditing] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [files, setFiles] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [problems, setProblems] = useState({});

  /**
   * The login, shown once after a hire. The stored password is a one-way hash
   * and cannot be read back later, so this is the only moment it can be handed
   * over.
   */
  const [credentials, setCredentials] = useState(null);

  /** Who a new employee can be put under. Fetched when the form first opens. */
  const [leaders, setLeaders] = useState([]);

  const isNew = editing === "new";
  const canCreate = can("employees", "create");
  const canEdit = can("employees", "edit");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

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

  useEffect(() => {
    if (editing !== "new" || leaders.length) return undefined;

    let active = true;

    hrApi
      .get("/hr/employees", {
        params: { role: "operations_manager", status: "active", limit: 200 },
      })
      .then(({ data }) => active && setLeaders(data.items || []))
      // A reporting line is optional, so failing to offer one is not an error
      // worth putting in front of somebody filling in a form
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [editing, leaders.length]);

  /* ------------------------------------------------------------ the form */

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  /** One field inside one of the two sub-documents. */
  const changeIn = (section) => (e) =>
    setForm((prev) => ({
      ...prev,
      [section]: { ...prev[section], [e.target.name]: e.target.value },
    }));

  const pickFile = (name, file) => setFiles((prev) => ({ ...prev, [name]: file }));

  const closeForm = () => {
    setEditing(null);
    setCredentials(null);
    setFiles({});
    setProblems({});
    setStep(0);
  };

  const openAdd = () => {
    setForm(BLANK);
    setFiles({});
    setFormError("");
    setProblems({});
    setCredentials(null);
    setStep(0);
    setEditing("new");
  };

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      ...BLANK,
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      designation: row.designation || "",
      department: row.department || "",
      status: row.status || "active",
      joiningDate: row.joiningDate ? new Date(row.joiningDate).toISOString().slice(0, 10) : "",
    });
    setFiles({});
    setFormError("");
    setProblems({});
    setStep(0);
  };

  /** What the first step will not move past. */
  const basicProblems = () => {
    const found = {};
    if (!String(form.name || "").trim()) found.name = "Enter their full name";
    if (!String(form.email || "").trim()) found.email = "Enter their email — it is the login ID";
    if (isNew && !String(form.phone || "").trim()) found.phone = "Enter a mobile number";
    return found;
  };

  const next = () => {
    const found = basicProblems();
    setProblems(found);
    if (Object.keys(found).length) return;

    setFormError("");
    setStep(1);
  };

  const save = async (e) => {
    e?.preventDefault();

    /**
     * An edit is one step and one request: this screen maintains the record
     * and deliberately cannot touch the login or the paperwork — the scans
     * have a route of their own.
     */
    if (!isNew) {
      const found = basicProblems();
      setProblems(found);
      if (Object.keys(found).length) return;

      setSaving(true);
      setFormError("");

      try {
        await hrApi.put(`/hr/employees/${editing}`, {
          name: form.name,
          email: form.email,
          phone: form.phone,
          designation: form.designation,
          department: form.department,
          status: form.status,
          joiningDate: form.joiningDate,
        });
        setEditing(null);
        reload();
      } catch (err) {
        setFormError(err.response?.data?.message || "Could not save this record");
      } finally {
        setSaving(false);
      }
      return;
    }

    /**
     * A hire is checked in full before anything is written — both steps, not
     * just the one on screen. The stepper lets somebody jump back, so
     * "I am standing on step two" is not the same as "step one is still
     * filled in".
     */
    const basics = basicProblems();
    if (Object.keys(basics).length) {
      setStep(0);
      setProblems(basics);
      return;
    }

    const papers = paperworkProblems(form);
    if (Object.keys(papers).length) {
      setStep(1);
      setProblems(papers);
      return;
    }

    setSaving(true);
    setFormError("");
    setProblems({});

    try {
      /**
       * Multipart, because of the scans. The two sub-documents travel as JSON
       * strings beside the files — a FormData is flat, and the server would
       * otherwise receive "documents[aadhaarNumber]" style keys to reassemble.
       * The same shape the admin panel's staff form sends.
       */
      const body = new FormData();

      const fields = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        designation: form.designation,
        department: form.department,
        status: form.status,
        address: form.address,
      };
      if (form.password) fields.password = form.password;
      if (form.joiningDate) fields.joiningDate = form.joiningDate;
      if (form.reportsTo) fields.reportsTo = form.reportsTo;

      Object.entries(fields).forEach(([key, value]) => body.append(key, value ?? ""));
      body.append("documents", JSON.stringify(form.documents));
      body.append("bank", JSON.stringify(form.bank));
      Object.entries(files).forEach(([name, file]) => file && body.append(name, file));

      await hrApi.post("/hr/employees", body);

      // The server falls back to the starting password when none is typed
      setCredentials({ loginId: form.email, password: form.password || form.phone });
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this record");
    } finally {
      setSaving(false);
    }
  };

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
          onClick={() => openEdit(row)}
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
            <Button onClick={openAdd}>
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
            <Button size="sm" className="ml-auto" onClick={openAdd}>
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

      {/* ------------------------------------------------- add and edit */}
      <Modal
        open={Boolean(editing)}
        onClose={closeForm}
        size="lg"
        title={isNew ? "Add employee" : "Edit record"}
        subtitle={
          credentials
            ? undefined
            : isNew
              ? `Step ${step + 1} of ${STEPS.length} · ${STEPS[step].blurb}`
              : "What somebody may sign in as is not changed from here"
        }
        footer={
          credentials ? (
            <Button onClick={closeForm}>Done</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => (isNew && step === 1 ? setStep(0) : closeForm())}
                disabled={saving}
              >
                {isNew && step === 1 ? "Back" : "Cancel"}
              </Button>
              {isNew && step === 0 ? (
                <Button onClick={next}>Next</Button>
              ) : (
                <Button onClick={save} loading={saving}>
                  {isNew ? "Create employee" : "Save"}
                </Button>
              )}
            </>
          )
        }
      >
        {credentials ? (
          <div className="space-y-3">
            <Alert tone="success">
              Account created. Pass these on now — the password cannot be shown again.
            </Alert>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                <KeyRound size={14} /> Login details
              </p>
              <p className="mt-2 text-slate-600">
                Email: <span className="font-mono text-slate-900">{credentials.loginId}</span>
              </p>
              <p className="text-slate-600">
                Password: <span className="font-mono text-slate-900">{credentials.password}</span>
              </p>
              <p className="mt-2 text-xs text-slate-500">They sign in at /employee/login</p>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <Alert>{formError}</Alert>

            {isNew && <Stepper step={step} onGo={(index) => index < step && setStep(index)} />}

            {(!isNew || step === 0) && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" required hint={problems.name}>
                    <Input name="name" value={form.name} onChange={change} />
                  </Field>
                  <Field label="Email" required hint={problems.email}>
                    <Input type="email" name="email" value={form.email} onChange={change} />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Phone"
                    required={isNew}
                    hint={problems.phone || (isNew ? "This becomes the login password" : undefined)}
                  >
                    <Input name="phone" value={form.phone} onChange={change} />
                  </Field>
                  <Field label="Designation">
                    <Input name="designation" value={form.designation} onChange={change} />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Department">
                    <Input name="department" value={form.department} onChange={change} />
                  </Field>
                  <Field label="Joined">
                    <Input
                      type="date"
                      name="joiningDate"
                      value={form.joiningDate}
                      onChange={change}
                    />
                  </Field>
                  <Field label="Status">
                    <Select
                      name="status"
                      value={form.status}
                      onChange={change}
                      options={[
                        { value: "active", label: "Active" },
                        { value: "inactive", label: "Inactive" },
                      ]}
                    />
                  </Field>
                </div>

                <Field label="Address">
                  <Textarea
                    name="address"
                    rows={2}
                    value={form.address}
                    onChange={change}
                    placeholder="House, street, city, state, PIN"
                  />
                </Field>

                {/* Only on a hire. An edit from this screen deliberately cannot
                    touch the login — see the controller's beforeSave. */}
                {isNew && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Reports to" hint="The operations manager who gives them work">
                      <Select
                        name="reportsTo"
                        value={form.reportsTo}
                        onChange={change}
                        placeholder="Not assigned yet"
                        options={leaders.map((person) => ({
                          value: person._id,
                          label: person.designation
                            ? `${person.name} — ${person.designation}`
                            : person.name,
                        }))}
                      />
                    </Field>
                    <Field label="Password" hint={`Blank uses ${DEFAULT_PASSWORD}`}>
                      <Input
                        name="password"
                        value={form.password}
                        onChange={change}
                        placeholder="••••••"
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {isNew && step === 1 && (
              <OnboardingFields
                form={form}
                changeIn={changeIn}
                files={files}
                pickFile={pickFile}
                problems={problems}
              />
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- stepper */

/**
 * Where in the form somebody is. Only steps already walked can be jumped back
 * to — on a create there is nothing behind step two until step one has been
 * filled in and checked.
 */
function Stepper({ step, onGo }) {
  return (
    <ol className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
      {STEPS.map((item, index) => {
        const here = index === step;
        const done = index < step;

        return (
          <li key={item.title} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!done}
              onClick={() => onGo(index)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                here
                  ? "bg-white text-blue-800 shadow-sm ring-1 ring-blue-200"
                  : done
                    ? "text-slate-600 hover:bg-white"
                    : "cursor-not-allowed text-slate-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  here || done ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"
                }`}
              >
                {index + 1}
              </span>
              <span className="truncate text-xs font-medium">{item.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
