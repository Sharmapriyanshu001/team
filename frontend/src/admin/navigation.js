import {
  LayoutDashboard,
  Users,
  UserCog,
  UsersRound,
  FolderKanban,
  ListChecks,
  MessagesSquare,
  AlertTriangle,
  FolderOpen,
  FileCode,
  Store,
  Search,
  Handshake,
  KeyRound,
  BarChart3,
  History,
  Bell,
  ShieldCheck,
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
  ["/admin/code-projects", "code_projects"],
  ["/admin/play", "play_console"],
  ["/admin/seo", "seo"],
  ["/admin/crm", "crm"],
  ["/admin/vault", "vault"],
  ["/admin/code-share", "code"],
  ["/admin/activity-logs", "activity_logs"],
  ["/admin/team-leaders", "team_leaders"],
  ["/admin/dashboard", "dashboard"],
  ["/admin/insights", "dashboard"],
  ["/admin/employees", "employees"],
  ["/admin/clients", "clients"],
  ["/admin/projects", "projects"],
  ["/admin/settings", "settings"],
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
 * This is presentation. The server refuses the same requests either way.
 */
export const visibleNavItems = (items, can) =>
  items
    .map((item) => {
      if (item.action || !item.to) {
        if (!item.children) return item;

        const children = item.children.filter((child) => {
          const module = moduleFor(child.to);
          return !module || can(module, "view");
        });
        return children.length ? { ...item, children } : null;
      }

      const module = moduleFor(item.to);
      return !module || can(module, "view") ? item : null;
    })
    .filter(Boolean);

export const NAV_ITEMS = [
  { label: "Dashboard", to: "/admin/dashboard", icon: LayoutDashboard },

  {
    label: "Clients",
    icon: Users,
    key: "clients",
    children: [
      { label: "All Clients", to: "/admin/clients" },
      { label: "Add Client", to: "/admin/clients/add" },
      { label: "Documents", to: "/admin/clients/documents" },
      { label: "Meetings", to: "/admin/clients/meetings" },
    ],
  },
  {
    label: "Team Leaders",
    icon: UserCog,
    key: "team-leaders",
    children: [
      { label: "All Team Leaders", to: "/admin/team-leaders" },
      { label: "Add Team Leader", to: "/admin/team-leaders/add" },
      { label: "Performance", to: "/admin/team-leaders/performance" },
    ],
  },
  {
    label: "Employees",
    icon: UsersRound,
    key: "employees",
    children: [
      { label: "All Employees", to: "/admin/employees" },
      { label: "Add Employee", to: "/admin/employees/add" },
      { label: "Attendance", to: "/admin/employees/attendance" },
      { label: "Performance", to: "/admin/employees/performance" },
    ],
  },
  {
    label: "Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "All Projects", to: "/admin/projects" },
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
  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Clients", to: "/admin/chat/clients" },
      { label: "Team Leaders", to: "/admin/chat/team-leaders" },
      { label: "Employees", to: "/admin/chat/employees" },
      { label: "Project Chats", to: "/admin/chat/projects" },
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
  {
    label: "Sales & Billing",
    icon: Handshake,
    key: "crm",
    children: [
      { label: "Leads", to: "/admin/crm/leads" },
      { label: "Quotations", to: "/admin/crm/quotations" },
      { label: "Invoices", to: "/admin/crm/invoices" },
    ],
  },
  { label: "Vault", to: "/admin/vault", icon: KeyRound },
  // Ungated on purpose, like the server route behind it: an inbox is how
  // this account is told what is happening to it, not a section that can be
  // granted or withheld.
  { label: "Notifications", to: "/admin/notifications", icon: Bell },
  { label: "Reports", to: "/admin/reports", icon: BarChart3 },
  { label: "Activity Logs", to: "/admin/activity-logs", icon: History },
  { label: "Roles & Permissions", to: "/admin/roles", icon: ShieldCheck },
  { label: "Settings", to: "/admin/settings", icon: Settings },
  { label: "Profile", to: "/admin/profile", icon: User },
];
