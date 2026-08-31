import {
  LayoutDashboard,
  FolderKanban,
  UsersRound,
  UserPlus,
  ListChecks,
  ClipboardCheck,
  Gauge,
  FolderOpen,
  FileCode,
  Store,
  Search,
  KeyRound,
  MessagesSquare,
  AlertTriangle,
  CalendarDays,
  Bell,
  BarChart3,
  User,
  LogOut,
} from "lucide-react";

/**
 * Sidebar for the team leader panel.
 * `clientChatEnabled` comes from the admin's settings — when it is off, the
 * Chat group drops its Client tab entirely.
 */
export const buildNavItems = ({
  clientChatEnabled = false,
  unread = 0,
  newTasks = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/team-leader/dashboard", icon: LayoutDashboard },

  {
    label: "My Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "Active Projects", to: "/team-leader/projects/active" },
      { label: "Completed Projects", to: "/team-leader/projects/completed" },
      { label: "Project Details", to: "/team-leader/projects/details" },
    ],
  },
  // The middle of admin → team leader → employee: the projects the admin
  // gave this leader, and everything needed to hand them down. Sits between
  // "My Projects" and "Team" because that is the order the work happens in.
  { label: "Assign Work", to: "/team-leader/assign-work", icon: UserPlus },

  {
    label: "Team",
    icon: UsersRound,
    key: "team",
    children: [
      { label: "Team Members", to: "/team-leader/team" },
      { label: "Performance", to: "/team-leader/team/performance" },
    ],
  },
  {
    label: "Tasks",
    icon: ListChecks,
    key: "tasks",
    // Work the admin handed to this leader in person, not yet looked at
    children: [
      { label: "Create Task", to: "/team-leader/tasks/create" },
      { label: "Assigned Tasks", to: "/team-leader/tasks/assigned" },
      { label: "Pending", to: "/team-leader/tasks/pending", dot: newTasks > 0 },
      { label: "Completed", to: "/team-leader/tasks/completed" },
    ],
  },

  { label: "Daily Work Review", to: "/team-leader/daily-review", icon: ClipboardCheck },
  { label: "Project Progress", to: "/team-leader/progress", icon: Gauge },
  { label: "Files", to: "/team-leader/files", icon: FolderOpen },
  // Mirrors the admin's Code section so the three meanings of "code" sit in
  // one place on every panel.
  {
    label: "Code",
    icon: FileCode,
    key: "code",
    children: [
      { label: "My Projects", to: "/team-leader/code-projects" },
      // Work this leader's own team submitted to them, waiting on a
      // decision. Distinct from "Shared Code", which is the admin's.
      { label: "Code Reviews", to: "/team-leader/code-reviews" },
      { label: "Send / Receive", to: "/team-leader/code-share" },
      { label: "Shared Code", to: "/team-leader/code" },
    ],
  },

  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Admin", to: "/team-leader/chat/admin" },
      { label: "Employees", to: "/team-leader/chat/employees" },
      ...(clientChatEnabled ? [{ label: "Client", to: "/team-leader/chat/clients" }] : []),
    ],
  },

  { label: "Play Store", to: "/team-leader/play", icon: Store },
  { label: "SEO & Social", to: "/team-leader/seo", icon: Search },
  { label: "Vault", to: "/team-leader/vault", icon: KeyRound },
  { label: "Issues", to: "/team-leader/issues", icon: AlertTriangle },
  { label: "Calendar", to: "/team-leader/calendar", icon: CalendarDays },
  { label: "Notifications", to: "/team-leader/notifications", icon: Bell, badge: unread },
  { label: "Reports", to: "/team-leader/reports", icon: BarChart3 },
  { label: "Profile", to: "/team-leader/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
