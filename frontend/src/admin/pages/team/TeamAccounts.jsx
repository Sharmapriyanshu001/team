import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Lock } from "lucide-react";

import usePermissions from "../../hooks/usePermissions";
import StaffList from "../staff/StaffList";
import StaffForm from "../staff/StaffForm";
import AllClients from "../clients/AllClients";
import AddClient from "../clients/AddClient";
import DepartmentAccounts from "../DepartmentAccounts";
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
    value: "manager",
    label: "Manager",
    module: "operations_managers",
    subtitle: "Department heads — they answer for a team's numbers and sign in at the operations manager panel",
    staff: { resource: "managers", title: "Manager" },
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

  const requested = params.get("type");
  const type = allowed.find((item) => item.value === requested) || allowed[0];

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
            options={allowed.map((item) => ({ value: item.value, label: item.label }))}
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
