import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Lock } from "lucide-react";

import usePermissions from "../../hooks/usePermissions";
import StaffList from "../staff/StaffList";
import StaffForm from "../staff/StaffForm";
import AllClients from "../clients/AllClients";
import AddClient from "../clients/AddClient";
import DepartmentAccounts from "../DepartmentAccounts";
import AllPeople from "./AllPeople";
import { EmptyState, PageHeader, Select } from "../../../shared/components/ui";

/**
 * Everybody with a login, behind one dropdown.
 *
 * The sidebar used to carry six separate sections for this — All Employee
 * Management, Managers, Operations Managers, Sales Managers, HR Accounts and
 * Clients — each of them a list, an add form and the same three row actions.
 * Six entries for one job, and an administrator had to already know which
 * heading a person was filed under before they could look them up.
 *
 * So: one section, one screen, and the kind of person as a choice on it.
 *
 * What this screen is NOT is a rewrite of those six. Every type below renders
 * the screen that already existed, with the API, the permission module, the
 * validation and the paperwork it already had — StaffList and StaffForm for
 * the three staff roles, DepartmentAccounts for the Sales and HR logins,
 * AllClients and AddClient for clients. They still answer on their own routes
 * for anything that links to them; this is a second door onto the same rooms,
 * not a second set of rooms. A bug fixed in one is fixed in both because there
 * is only one of each.
 *
 * The type lives in the URL rather than in state, so a particular list can be
 * linked to, bookmarked and reached with the back button — "?type=client" is
 * as good an address as /admin/clients ever was.
 *
 * Managers are the one of the six not offered here. The screen was not
 * deleted with the choice — /admin/managers still answers, and still adds and
 * edits them — it is simply not a kind of person this panel asks about.
 */

/**
 * What each type is and which screen answers for it.
 *
 * `module` is the permission module the server already guards that type with,
 * so this list cannot invent access: a department account that may not see
 * employees does not get Employee in the dropdown, and would be refused by the
 * API even if it did. `adminOnly` marks the two that requireFullAdmin closes
 * to department accounts outright — an account that can create accounts can
 * grant itself any module, which is not a question a permission can safely
 * answer.
 */
const TYPES = [
  {
    value: "employee",
    label: "Employee",
    module: "employees",
    subtitle: "Everyone working on site and in the office",
    staff: {
      resource: "employees",
      title: "Employee",
      showOperationsManager: true,
    },
    links: [
      { label: "Performance", to: "/admin/employees/performance" },
      { label: "Attendance", to: "/admin/employees/attendance" },
    ],
  },
  {
    value: "operation-manager",
    label: "Operation Manager",
    module: "operations_managers",
    subtitle: "They run the projects, and the employees report to them",
    staff: { resource: "operations-managers", title: "Operations Manager" },
    links: [{ label: "Performance", to: "/admin/operations-managers/performance" }],
  },
  {
    value: "sales-manager",
    label: "Sales Manager",
    module: "department_accounts",
    adminOnly: true,
    subtitle: "Logins for the Sales team — they sign in at /sales",
    department: "sales",
  },
  {
    value: "hr",
    label: "HR",
    module: "department_accounts",
    adminOnly: true,
    subtitle: "Logins for the HR team — they sign in at /hr, as many as you need",
    department: "hr",
  },
  {
    value: "client",
    label: "Client",
    module: "clients",
    subtitle: "The people the work is for, and their portal logins",
    client: true,
    links: [
      { label: "Handover queue", to: "/admin/clients/handover" },
      { label: "Documents", to: "/admin/clients/documents" },
      { label: "Meetings", to: "/admin/clients/meetings" },
    ],
  },
];

/**
 * Where the combined view fetches one type from.
 *
 * Derived from what the type already says about itself rather than written
 * down a second time, so a resource that moves has one place to move.
 */
const sourceFor = (type) => {
  let path = "/admin/department-accounts";
  if (type.staff) path = `/admin/${type.staff.resource}`;
  else if (type.client) path = "/admin/clients";

  return {
    value: type.value,
    label: type.label,
    path,
    params: type.department ? { role: type.department } : undefined,
    /**
     * Staff and clients open one record on this panel's own URL. The
     * department logins keep their form in a modal on their own list, so the
     * most that can be done for one of those is put their list on screen.
     */
    routable: Boolean(type.staff || type.client),
    /**
     * Which profile drawer View opens, and what to fetch for it.
     *
     * Staff and clients read through two different screens — the tabbed staff
     * profile and the client one — and a row here opens the same drawer its
     * own list opens rather than a third rendering of the same record. A Sales
     * or HR login has no /details endpoint behind it at all, so those rows
     * offer no View instead of an eye that leads nowhere.
     */
    detail: type.staff
      ? { kind: "staff", resource: type.staff.resource }
      : type.client
        ? { kind: "client", resource: "clients" }
        : null,
  };
};

/**
 * The one choice in the dropdown that is not a kind of person.
 *
 * Offered only where there is more than one kind to combine — with a single
 * type allowed, "All" and that type are the same list under two names.
 */
const ALL = {
  value: "all",
  label: "All",
  subtitle: "Everyone with a login — staff, department accounts and clients",
};

/**
 * The screens this panel does not contain.
 *
 * Performance, the handover queue, the document register and the meetings
 * board were children of the sidebar groups this screen replaced. They are not
 * "manage a person", so they are not types in the dropdown — but they are one
 * click from the type they belong to rather than gone, which is the whole
 * difference between tidying a menu and losing a screen.
 */
function RelatedLinks({ links }) {
  if (!links?.length) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
        >
          {link.label}
          <ArrowUpRight size={13} className="text-slate-400" />
        </Link>
      ))}
    </div>
  );
}

export default function TeamAccounts() {
  const [params, setParams] = useSearchParams();
  const { can, isFullAdmin, loading } = usePermissions();

  /**
   * Only the types this account may actually manage.
   *
   * `can` answers true while the permissions are still loading, which is
   * deliberate everywhere in this panel: showing a choice for a moment and
   * having the server refuse it beats the screen flickering as the answer
   * arrives.
   */
  const allowed = TYPES.filter(
    (type) => (!type.adminOnly || isFullAdmin) && can(type.module, "view")
  );

  const choices = allowed.length > 1 ? [ALL, ...allowed] : allowed;
  const addable = allowed.find((item) => item.staff || item.client);

  /**
   * All is what the screen opens on: somebody arriving here is usually looking
   * for a person rather than for a category, and having to guess which list
   * holds them is the step this view exists to remove. A named type in the URL
   * still wins, so every existing link keeps landing where it always did.
   */
  const requested = params.get("type");
  const type = choices.find((item) => item.value === requested) || choices[0];

  /**
   * Switching type starts that type clean — the form flag and any record id
   * belong to the type that was open, and carrying them across would ask an
   * employee form to edit a client.
   */
  const chooseType = (value) => setParams({ type: value });

  const listPath = type ? `/admin/team?type=${type.value}` : "/admin/team";
  const addPath = `${listPath}&form=new`;
  const editPath = (id) => `${listPath}&id=${id}`;

  // Staff and clients keep their list and their form on this one URL
  const showForm = Boolean(params.get("id")) || params.get("form") === "new";

  if (!type) {
    return (
      <div>
        <PageHeader
          title="Team & Accounts"
          subtitle="Staff, department logins and clients"
        />
        <EmptyState
          icon={Lock}
          title={loading ? "Checking what you can open…" : "Nothing here for your account"}
          message={
            loading
              ? undefined
              : "Your role does not include employees, managers, department logins or clients. An administrator can grant one of those from Roles & Permissions."
          }
        />
      </div>
    );
  }

  const renderBody = () => {
    if (type.value === ALL.value) {
      return (
        <AllPeople
          sources={allowed.map(sourceFor)}
          /**
           * Add, on the one view looking at every kind at once.
           *
           * It opens the first kind this account may add, which is Employee
           * wherever employees are allowed at all — far and away what this
           * panel is used to add, and the type dropdown is right there for the
           * rest. The Sales and HR logins are not candidates for it: their
           * form is a modal on their own list rather than a URL, so Add would
           * have landed on a list instead of a form.
           */
          addPath={addable ? `/admin/team?type=${addable.value}&form=new` : ""}
          hrefFor={(row) =>
            row.source.routable
              ? `/admin/team?type=${row.source.value}&id=${row._id}`
              : `/admin/team?type=${row.source.value}`
          }
        />
      );
    }

    if (type.staff) {
      return showForm ? (
        <StaffForm
          embedded
          resource={type.staff.resource}
          title={type.staff.title}
          listPath={listPath}
          showOperationsManager={type.staff.showOperationsManager}
        />
      ) : (
        <StaffList
          embedded
          resource={type.staff.resource}
          title={type.staff.title}
          addPath={addPath}
          editPath={editPath}
          addLabel={`Add ${type.label.toLowerCase()}`}
          showOperationsManager={type.staff.showOperationsManager}
        />
      );
    }

    if (type.client) {
      return showForm ? (
        <AddClient embedded listPath={listPath} />
      ) : (
        <AllClients embedded addPath={addPath} editPath={editPath} />
      );
    }

    /**
     * Sales and HR logins. This screen keeps its list and its form on the same
     * page — the form is a modal it opens itself — so there is no form view to
     * route to, and its own Add button is the one on the toolbar.
     */
    return <DepartmentAccounts embedded lockedRole={type.department} />;
  };

  return (
    <div>
      <PageHeader title="Team & Accounts" subtitle={type.subtitle}>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Manage</span>
          <Select
            value={type.value}
            onChange={(e) => chooseType(e.target.value)}
            options={choices.map((item) => ({ value: item.value, label: item.label }))}
            aria-label="Which kind of person to manage"
            className="w-auto min-w-[190px] font-medium"
          />
        </label>
      </PageHeader>

      {/* Hidden while a form is open: they lead away from a half-filled form */}
      {!showForm && <RelatedLinks links={type.links} />}

      {renderBody()}
    </div>
  );
}
