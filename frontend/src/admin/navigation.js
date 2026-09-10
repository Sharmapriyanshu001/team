import {
  LayoutDashboard,
  UsersRound,
  UserPlus,
  CalendarCheck,
  CalendarOff,
  Network,
  Building2,
  FolderKanban,
  ListChecks,
  MessagesSquare,
  AlertTriangle,
  FolderOpen,
  FileCode,
  Store,
  Search,
  Handshake,
  Megaphone,
  Landmark,
  KeyRound,
  BarChart3,
  History,
  Bell,
  ShieldCheck,
  IdCard,
  Settings,
  User,
} from "lucide-react";

// Single source of truth for the sidebar. `children` renders a collapsible group.
/**
 * Which permission module each part of the sidebar belongs to, matched on the
 * longest path prefix. Kept beside the nav rather than inside it so the item
 * list stays a plain description of the panel — and so a new screen that
 * forgets to declare a module simply stays visible and is refused by the
 * server, rather than vanishing for everyone.
 */
const MODULE_BY_PATH = [
  ["/admin/department-accounts", "department_accounts"],
  ["/admin/code-projects", "code_projects"],
  ["/admin/hr/recruitment", "recruitment"],
  ["/admin/hr/accounts", "department_accounts"],
  ["/admin/sales/managers", "department_accounts"],
  ["/admin/hr/leave", "leaves"],
  ["/admin/hr", "employees"],
  ["/admin/play", "play_console"],
  ["/admin/seo", "seo"],
  ["/admin/crm", "crm"],
  ["/admin/ads", "ads"],
  ["/admin/portfolio", "portfolio"],
  ["/admin/teams", "teams"],
  ["/admin/vault", "vault"],
  ["/admin/code-share", "code"],
  ["/admin/activity-logs", "activity_logs"],
  ["/admin/operations-managers", "operations_managers"],
  ["/admin/managers", "operations_managers"],
  ["/admin/dashboard", "dashboard"],
  ["/admin/insights", "dashboard"],
  ["/admin/employees", "employees"],
  ["/admin/clients", "clients"],
  ["/admin/projects", "projects"],
  ["/admin/settings", "settings"],
  ["/admin/departments", "reports"],
  ["/admin/reports", "reports"],
  ["/admin/issues", "issues"],
  ["/admin/tasks", "tasks"],
  ["/admin/roles", "roles"],
  ["/admin/files", "files"],
  ["/admin/chat", "chat"],
  ["/admin/code", "code"],
].sort((a, b) => b[0].length - a[0].length);

const moduleFor = (to) => MODULE_BY_PATH.find(([prefix]) => to?.startsWith(prefix))?.[1] || null;

/**
 * The sidebar this admin should see. A group disappears only when every one
 * of its children is out of reach — a half-usable group is still usable.
 *
 * A section heading survives only if something under it did. Otherwise an HR
 * account gets "SALES" and "MARKETING" printed over empty space, which reads
 * like the panel is broken rather than like it is theirs.
 *
 * This is presentation. The server refuses the same requests either way.
 */
export const visibleNavItems = (items, can, { isFullAdmin = true } = {}) => {
  const kept = items
    .map((item) => {
      if (item.section) return item;

      /**
       * A handful of screens are closed to department accounts outright,
       * whatever their role grants — the roles editor and the department
       * logins. The server refuses them with requireFullAdmin, and offering a
       * door that answers 403 is worse than not offering it.
       */
      if (item.adminOnly && !isFullAdmin) return null;

      if (item.action || !item.to) {
        if (!item.children) return item;

        const children = item.children.filter((child) => {
          if (child.adminOnly && !isFullAdmin) return false;
          const module = moduleFor(child.to);
          return !module || can(module, "view");
        });
        return children.length ? { ...item, children } : null;
      }

      /**
       * A screen that spans several modules — the Team & Accounts panel —
       * declares them all and is kept for an account holding any one of them.
       * The panel itself then offers only the parts that account may open.
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
  { label: "Dashboard", to: "/admin/dashboard", icon: LayoutDashboard },

  /* ------------------------------------------------------- Team & Accounts */

  /**
   * Everybody with a login, behind one entry.
   *
   * This was six sections — All Employee Management, Managers, Operations
   * Managers, Sales Managers, HR Accounts and Clients — each of them a list,
   * an add form and the same three row actions. Six headings for one job, and
   * an administrator had to already know which one somebody was filed under
   * before they could look them up: Operations Managers were under HR, Sales
   * Managers under Sales.
   *
   * The screen behind this keeps the kind of person in a dropdown and renders
   * exactly the list and form each type always had — see pages/team.
   *
   * No module of its own: it spans employees, operations_managers,
   * department_accounts and clients, so it is kept for an account that holds
   * any of them and the panel offers only the types that account may open.
   */
  { section: "Team & Accounts" },
  {
    label: "People & Accounts",
    to: "/admin/team",
    icon: UsersRound,
    modules: ["employees", "operations_managers", "department_accounts", "clients"],
  },

  /* ------------------------------------------------------------------ HR */

  /**
   * The three sections below are the company flow the panel is organised
   * around — HR the people, Sales the money coming in, Operations the
   * delivery. Grouping by department rather than by record type is what lets
   * somebody who does one job find their own screens without reading the
   * other twenty.
   */
  { section: "Human Resources" },
  { label: "HR Overview", to: "/admin/hr", icon: IdCard, end: true },
  { label: "Attendance", to: "/admin/employees/attendance", icon: CalendarCheck },
  {
    label: "Leave",
    icon: CalendarOff,
    key: "leave",
    children: [
      { label: "Requests", to: "/admin/hr/leave" },
      { label: "Balances", to: "/admin/hr/leave/balances" },
      { label: "Policies", to: "/admin/hr/leave/policies" },
    ],
  },
  { label: "Recruitment", to: "/admin/hr/recruitment", icon: UserPlus },

  /* --------------------------------------------------------------- Sales */

  { section: "Sales" },
  {
    label: "Pipeline",
    icon: Handshake,
    key: "crm",
    children: [
      { label: "Leads", to: "/admin/crm/leads" },
      { label: "Follow-ups", to: "/admin/crm/follow-ups" },
      { label: "Quotations", to: "/admin/crm/quotations" },
      { label: "Invoices", to: "/admin/crm/invoices" },
    ],
  },

  /* ---------------------------------------------------------- Operations */

  { section: "Operations" },
  {
    label: "Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "All Projects", to: "/admin/projects" },
      // Every client change request in the company, with its whole history
      { label: "Change Requests", to: "/admin/change-requests" },
      /**
       * Money on projects. Sits under Projects because that is where somebody
       * looks for it, and is guarded by the CRM permission rather than the
       * projects one — running delivery does not make somebody entitled to the
       * client's payment references.
       */
      { label: "Payments", to: "/admin/project-payments" },
      { label: "Create Project", to: "/admin/projects/create" },
      { label: "Assign Team", to: "/admin/projects/assign-team" },
      { label: "Timeline", to: "/admin/projects/timeline" },
    ],
  },
  {
    label: "Tasks",
    icon: ListChecks,
    key: "tasks",
    children: [
      { label: "Daily Tasks", to: "/admin/tasks/daily" },
      { label: "Pending", to: "/admin/tasks/pending" },
      { label: "Completed", to: "/admin/tasks/completed" },
      { label: "Reviews", to: "/admin/tasks/reviews" },
    ],
  },
  { label: "Issues", to: "/admin/issues", icon: AlertTriangle },
  { label: "Files", to: "/admin/files", icon: FolderOpen },
  // One Code section holding the three things "code" means here: projects
  // people open in the browser, archives sent person to person, and the
  // submit-and-approve review pipeline.
  {
    label: "Code",
    icon: FileCode,
    key: "code",
    children: [
      { label: "Code Projects", to: "/admin/code-projects" },
      // What the team has asked the admin to change or delete, and what has
      // been deleted but not yet destroyed. Same module as Code Projects, so
      // an admin who cannot see those cannot see this either.
      { label: "Requests & Bin", to: "/admin/code-projects/requests" },
      { label: "Send / Receive", to: "/admin/code-share" },
      { label: "Code Review", to: "/admin/code" },
    ],
  },

  /* ------------------------------------------------------------ Marketing */

  { section: "Marketing & Delivery" },
  // Google Play: the developer accounts, what is published on them, and what
  // Google is unhappy about. One permission module — see adminRoutes.
  {
    label: "Play Store",
    icon: Store,
    key: "play",
    children: [
      { label: "Consoles", to: "/admin/play/consoles" },
      { label: "Apps", to: "/admin/play/apps" },
      { label: "Policy Notices", to: "/admin/play/alerts" },
    ],
  },
  {
    label: "SEO & Social",
    icon: Search,
    key: "seo",
    children: [
      { label: "Engagements", to: "/admin/seo" },
      { label: "Social", to: "/admin/seo/social" },
    ],
  },
  { label: "Ads", to: "/admin/ads", icon: Megaphone },
  // Our own apps and sites, as opposed to everything else here, which is
  // work done for somebody else
  { label: "Our Portfolio", to: "/admin/portfolio", icon: Landmark },

  /* -------------------------------------------------------------- Company */

  { section: "Company" },
  // The company's own shape: departments, who runs them, and their numbers
  { label: "Teams & Targets", to: "/admin/teams", icon: Network },
  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Clients", to: "/admin/chat/clients" },
      { label: "Operations Managers", to: "/admin/chat/operations-managers" },
      { label: "Employees", to: "/admin/chat/employees" },
      { label: "Project Chats", to: "/admin/chat/projects" },
    ],
  },
  { label: "Vault", to: "/admin/vault", icon: KeyRound },
  { label: "Reports", to: "/admin/reports", icon: BarChart3 },
  // What the chain carries, and what each department did with it. Separate
  // from Reports, which is the company-wide analytics view.
  { label: "Report Chain", to: "/admin/reports/chain", icon: Network },
  { label: "Departments", to: "/admin/departments", icon: Building2 },

  /* ----------------------------------------------------------- Administration */

  { section: "Administration" },
  // Ungated on purpose, like the server route behind it: an inbox is how
  // this account is told what is happening to it, not a section that can be
  // granted or withheld.
  { label: "Notifications", to: "/admin/notifications", icon: Bell },
  { label: "Activity Logs", to: "/admin/activity-logs", icon: History },
  /**
   * The department logins — HR, Sales and Operations. Marked adminOnly
   * because the route behind it is closed to department accounts by
   * requireFullAdmin whatever their role grants: an account that can create
   * accounts can grant itself any module, so it is not a permission question.
   */
  {
    label: "Department Accounts",
    to: "/admin/department-accounts",
    icon: IdCard,
    adminOnly: true,
  },
  { label: "Roles & Permissions", to: "/admin/roles", icon: ShieldCheck, adminOnly: true },
  { label: "Settings", to: "/admin/settings", icon: Settings },
  { label: "Profile", to: "/admin/profile", icon: User },
];
