import {
  Network,
  Trophy,
  Bell,
  LayoutDashboard,
  UsersRound,
  Building2,
  CalendarCheck,
  CalendarOff,
  Briefcase,
  FolderOpen,
  BarChart3,
  User,
} from "lucide-react";

/**
 * The HR panel's sidebar.
 *
 * Every entry here is HR work, because the panel behind it contains nothing
 * else — there is no route under /api/hr that touches a lead, an invoice, a
 * project or the vault. So unlike the admin panel's nav, this one is not
 * gating access to other departments; the only thing it hides is the screen
 * that manages HR's own logins, which belongs to the HR head alone.
 */

const MODULE_BY_PATH = [
  ["/hr/incentives", "incentives"],
  ["/hr/client-records", "client_records"],
  ["/hr/sales-managers", "sales_managers"],
  ["/hr/department-managers", "department_managers"],
  ["/hr/operations-managers", "operations_managers"],
  ["/hr/managers", "hr_managers"],
  // The whole Hiring section is one module: somebody who may see a candidate
  // has to be able to see the opening behind them for any of it to mean
  // anything, so splitting it would only produce half-usable screens.
  ["/hr/hiring", "hiring"],
  ["/hr/attendance", "attendance"],
  ["/hr/employees", "employees"],
  ["/hr/documents", "documents"],
  ["/hr/dashboard", "dashboard"],
  ["/hr/reporting-lines", "employees"],
  ["/hr/departments", "reports"],
  ["/hr/reports", "reports"],
  ["/hr/leave", "leaves"],
].sort((a, b) => b[0].length - a[0].length);

const moduleFor = (to) => MODULE_BY_PATH.find(([prefix]) => to?.startsWith(prefix))?.[1] || null;

/**
 * The sidebar this HR account should see. A group disappears only when every
 * one of its children is out of reach.
 *
 * Presentation only — the server refuses the same requests either way.
 */
export const visibleNavItems = (items, can) => {
  const kept = items
    .map((item) => {
      if (item.section) return item;

      if (!item.to) {
        if (!item.children) return item;

        const children = item.children.filter((child) => {
          const module = moduleFor(child.to);
          return !module || can(module, "view");
        });
        return children.length ? { ...item, children } : null;
      }

      /**
       * A screen that spans several modules — the People panel — declares
       * them all and is kept for an account holding any one of them. The
       * panel itself then offers only the parts that account may open.
       */
      if (item.modules) {
        return item.modules.some((module) => can(module, "view")) ? item : null;
      }

      const module = moduleFor(item.to);
      return !module || can(module, "view") ? item : null;
    })
    .filter(Boolean);

  // Drop a heading with nothing left under it, and any trailing one
  return kept.filter((item, index) => {
    if (!item.section) return true;
    const next = kept[index + 1];
    return Boolean(next) && !next.section;
  });
};

export const NAV_ITEMS = [
  { label: "Dashboard", to: "/hr/dashboard", icon: LayoutDashboard },

  /**
   * Everybody HR opens a login for, behind one entry.
   *
   * This was five: Employees, Managers, Operations Managers, Sales Managers
   * and HR Managers — each a list, a form and the same three row actions,
   * differing only in which kind of person they were about. Somebody hiring
   * had to know which heading a role was filed under before they could add
   * anybody.
   *
   * The screen behind this keeps the kind of person in a dropdown and renders
   * exactly the list each type always had — see pages/People.jsx.
   *
   * No single module: it spans all five, so it is kept for an account holding
   * any of them and the panel offers only the types that account may open —
   * the HR logins stay the HR head's, as they always were.
   */
  { section: "People" },
  {
    label: "All Candidates",
    to: "/hr/people",
    icon: UsersRound,
    modules: [
      "employees",
      "department_managers",
      "operations_managers",
      "sales_managers",
      "hr_managers",
    ],
  },
  /**
   * Clients whose details Sales has passed on. Read-only — it is a record of
   * what arrived, not a second place to manage the relationship.
   */
  { label: "Client Records", to: "/hr/client-records", icon: Building2 },
  /**
   * Points earned against deadlines, and the bonus they add up to. HR's
   * because the bonus is payroll.
   */
  { label: "Incentives", to: "/hr/incentives", icon: Trophy },
  { label: "Documents", to: "/hr/documents", icon: FolderOpen },

  { section: "Time" },
  { label: "Attendance", to: "/hr/attendance", icon: CalendarCheck },
  {
    label: "Leave",
    icon: CalendarOff,
    key: "leave",
    children: [
      { label: "Requests", to: "/hr/leave" },
      { label: "Balances", to: "/hr/leave/balances" },
      { label: "Policies", to: "/hr/leave/policies" },
    ],
  },

  { section: "Hiring" },
  /**
   * The whole chain, in the order it runs:
   *
   *   Job Opening → Candidate → Interview → Shortlisted → Selected
   *                                                          ↓
   *                                       Employee ← Onboarding
   *
   * Shortlisted, Selected and Rejected are the same records as Candidates seen
   * at one stage each — they are listed separately because they are the three
   * questions somebody actually opens the panel to answer.
   */
  {
    label: "Hiring",
    icon: Briefcase,
    key: "hiring",
    children: [
      { label: "Hiring Dashboard", to: "/hr/hiring/dashboard" },
      { label: "Job Openings", to: "/hr/hiring/openings" },
      { label: "Candidates", to: "/hr/hiring/candidates" },
      { label: "Interviews", to: "/hr/hiring/interviews" },
      { label: "Shortlisted", to: "/hr/hiring/shortlisted" },
      { label: "Selected", to: "/hr/hiring/selected" },
      { label: "Rejected", to: "/hr/hiring/rejected" },
      { label: "Onboarding", to: "/hr/hiring/onboarding" },
    ],
  },

  { section: "Company" },
  { label: "Reports", to: "/hr/reports", icon: BarChart3 },
  // Staffing the chain: which manager each person works under. Departments
  // above shows the shape; this is where it is changed.
  { label: "Reporting Lines", to: "/hr/reporting-lines", icon: Network },
  { label: "Departments", to: "/hr/departments", icon: Building2 },
  // Ungated, like the route behind it — an inbox is how this account is told
  // what is happening to it. Leave requests and hiring updates land here.
  { label: "Notifications", to: "/hr/notifications", icon: Bell },

  { label: "Profile", to: "/hr/profile", icon: User },
];
