import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Lock } from "lucide-react";

import useHrAccess from "../hooks/useHrAccess";
import Employees from "./Employees";
import DepartmentManagers from "./DepartmentManagers";
import OperationsManagers from "./OperationsManagers";
import SalesManagers from "./SalesManagers";
import HrManagers from "./HrManagers";
import { EmptyState, Loader, PageHeader, Select } from "../../shared/components/ui";

/**
 * Everybody HR opens a login for, behind one dropdown.
 *
 * The People section had grown to five entries — Employees, Managers,
 * Operations Managers, Sales Managers and HR Managers — each of them a list, a
 * form and the same three row actions, differing only in which kind of person
 * they were about. Five headings for one job, and somebody hiring had to know
 * which heading a role was filed under before they could add anybody.
 *
 * So: one screen, and the kind of person as a choice on it. The same shape the
 * admin panel's Team & Accounts panel took, for the same reason.
 *
 * Every type below renders the screen that already existed, with the routes,
 * the guards, the paperwork rules and the confirmations it already had. This
 * is a second door onto those rooms, not a second set of rooms — and they keep
 * answering on their own paths, so nothing that links to one has moved.
 */

/**
 * What each type is and which screen answers for it.
 *
 * `module` is the HR permission module the server already guards that type
 * with, so this list cannot invent access: an HR Manager does not see the HR
 * logins here, and /api/hr/managers would refuse them even if they did. See
 * utils/hrAccess.js.
 */
const TYPES = [
  {
    value: "employee",
    label: "Employee",
    module: "employees",
    subtitle: "Everybody on the payroll — hire one straight in, or bring them through Hiring.",
    Screen: Employees,
    /**
     * Both ways in, because there are two.
     *
     * Somebody filling a vacancy arrives through Candidates and Onboarding,
     * and that chain is where the decision and its paper trail live. Somebody
     * who starts on Monday with a signed offer does not need a vacancy opened
     * behind them, and Add on this screen is for them.
     */
    links: [
      { label: "Onboarding", to: "/hr/hiring/onboarding" },
      { label: "Candidates", to: "/hr/hiring/candidates" },
    ],
  },
  {
    value: "manager",
    label: "Manager",
    module: "department_managers",
    subtitle: "Department heads who run a team. They sign in at the operations manager panel.",
    Screen: DepartmentManagers,
  },
  {
    value: "operation-manager",
    label: "Operation Manager",
    module: "operations_managers",
    subtitle: "They run the projects and the employees report to them.",
    Screen: OperationsManagers,
  },
  {
    value: "sales-manager",
    label: "Sales Manager",
    module: "sales_managers",
    subtitle: "Logins for the Sales panel — they sign in at /sales/login.",
    Screen: SalesManagers,
  },
  {
    value: "hr",
    label: "HR",
    module: "hr_managers",
    subtitle: "Logins for the HR team itself — the HR head opens these.",
    Screen: HrManagers,
  },
];

/** Where the work for a type carries on, when it is not on this screen. */
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

export default function People() {
  const [params, setParams] = useSearchParams();
  const { can, loading } = useHrAccess();

  /**
   * Only the types this account may actually manage.
   *
   * Unlike the admin panel's, HR's `can` answers false until the permissions
   * land — so the screen waits rather than flashing "nothing here" at an
   * account that has everything.
   */
  const allowed = TYPES.filter((type) => can(type.module, "view"));

  const requested = params.get("type");
  const type = allowed.find((item) => item.value === requested) || allowed[0];

  // Switching type starts that type clean — nothing in the URL belongs to two
  const chooseType = (value) => setParams({ type: value });

  if (loading) {
    return (
      <div>
        <PageHeader title="People" subtitle="Staff and the logins they sign in with" />
        <Loader />
      </div>
    );
  }

  if (!type) {
    return (
      <div>
        <PageHeader title="People" subtitle="Staff and the logins they sign in with" />
        <EmptyState
          icon={Lock}
          title="Nothing here for your account"
          message="Your HR role does not include employees, managers or any of the department logins."
        />
      </div>
    );
  }

  const { Screen } = type;

  return (
    <div>
      <PageHeader title="People" subtitle={type.subtitle}>
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

      <RelatedLinks links={type.links} />

      <Screen embedded />
    </div>
  );
}
