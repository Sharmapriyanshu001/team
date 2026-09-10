import {
  LayoutDashboard,
  FolderKanban,
  UsersRound,
  UserPlus,
  ListChecks,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  FolderOpen,
  FileCode,
  Store,
  Search,
  KeyRound,
  Megaphone,
  Network,
  MessagesSquare,
  AlertTriangle,
  CalendarDays,
  Bell,
  BarChart3,
  User,
  LogOut,
} from "lucide-react";

/**
 * Sidebar for the operations manager panel.
 * `clientChatEnabled` comes from the admin's settings — when it is off, the
 * Chat group drops its Client tab entirely.
 */
export const buildNavItems = ({
  clientChatEnabled = false,
  unread = 0,
  newTasks = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/operation-manager/dashboard", icon: LayoutDashboard },

  {
    label: "My Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "Active Projects", to: "/operation-manager/projects/active" },
      { label: "Completed Projects", to: "/operation-manager/projects/completed" },
      // What the clients on those projects have asked to be changed
      { label: "Client Changes", to: "/operation-manager/change-requests" },
      { label: "Project Details", to: "/operation-manager/projects/details" },
    ],
  },
  // The middle of admin → operations manager → employee: the projects the admin
  // gave this leader, and everything needed to hand them down. Sits between
  // "My Projects" and "Team" because that is the order the work happens in.
  { label: "Assign Work", to: "/operation-manager/assign-work", icon: UserPlus },

  {
    label: "Team",
    icon: UsersRound,
    key: "team",
    children: [
      { label: "Team Members", to: "/operation-manager/team" },
      { label: "Performance", to: "/operation-manager/team/performance" },
    ],
  },
  {
    label: "Tasks",
    icon: ListChecks,
    key: "tasks",
    // Work the admin handed to this leader in person, not yet looked at
    children: [
      { label: "Create Task", to: "/operation-manager/tasks/create" },
      { label: "Assigned Tasks", to: "/operation-manager/tasks/assigned" },
      { label: "Pending", to: "/operation-manager/tasks/pending", dot: newTasks > 0 },
      { label: "Completed", to: "/operation-manager/tasks/completed" },
    ],
  },

  { label: "Daily Work Review", to: "/operation-manager/daily-review", icon: ClipboardCheck },
  { label: "Project Progress", to: "/operation-manager/progress", icon: Gauge },
  { label: "Files", to: "/operation-manager/files", icon: FolderOpen },
  // Mirrors the admin's Code section so the three meanings of "code" sit in
  // one place on every panel.
  {
    label: "Code",
    icon: FileCode,
    key: "code",
    children: [
      { label: "My Projects", to: "/operation-manager/code-projects" },
      // Work this leader's own team submitted to them, waiting on a
      // decision. Distinct from "Shared Code", which is the admin's.
      { label: "Code Reviews", to: "/operation-manager/code-reviews" },
      { label: "Send / Receive", to: "/operation-manager/code-share" },
      { label: "Shared Code", to: "/operation-manager/code" },
    ],
  },

  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Admin", to: "/operation-manager/chat/admin" },
      { label: "Employees", to: "/operation-manager/chat/employees" },
      ...(clientChatEnabled ? [{ label: "Client", to: "/operation-manager/chat/clients" }] : []),
    ],
  },

  { label: "Play Store", to: "/operation-manager/play", icon: Store },
  { label: "SEO & Social", to: "/operation-manager/seo", icon: Search },
  { label: "My Team", to: "/operation-manager/my-team", icon: Network },
  { label: "Ads", to: "/operation-manager/ads", icon: Megaphone },
  { label: "Vault", to: "/operation-manager/vault", icon: KeyRound },
  { label: "Issues", to: "/operation-manager/issues", icon: AlertTriangle },
  { label: "Calendar", to: "/operation-manager/calendar", icon: CalendarDays },
  // The rules a manager is approving leave against. Read-only — HR writes them.
  { label: "Leave Policies", to: "/operation-manager/leave-policies", icon: ClipboardList },
  { label: "Notifications", to: "/operation-manager/notifications", icon: Bell, badge: unread },
  { label: "Reports", to: "/operation-manager/reports", icon: BarChart3 },
  // The team files its updates here and the manager answers them, then sends
  // one team update up to HR.
  { label: "Report Chain", to: "/operation-manager/report-chain", icon: ClipboardList },
  { label: "Profile", to: "/operation-manager/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
