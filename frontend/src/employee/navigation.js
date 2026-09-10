import {
  Trophy,
  LayoutDashboard,
  Inbox,
  FolderKanban,
  ListChecks,
  ClipboardList,
  SendHorizontal,
  History,
  FolderOpen,
  FileCode,
  Store,
  Search,
  KeyRound,
  Megaphone,
  Network,
  MessagesSquare,
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  Bell,
  User,
  LogOut,
} from "lucide-react";

/**
 * Sidebar for the employee panel.
 * The Client chat tab only appears when the admin has enabled it.
 */
export const buildNavItems = ({
  clientChatEnabled = false,
  unread = 0,
  newTasks = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/employee/dashboard", icon: LayoutDashboard },

  // Everything an operations manager has handed over — the project, the task and the
  // code that came with it — in one place, so being given something is
  // noticed rather than discovered on a third screen.
  { label: "My Work", to: "/employee/my-work", icon: Inbox, dot: newTasks > 0 },

  {
    label: "My Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "Active Projects", to: "/employee/projects/active" },
      { label: "Completed Projects", to: "/employee/projects/completed" },
      // Changes a client asked for on a project this person is on
      { label: "Client Changes", to: "/employee/change-requests" },
    ],
  },
  {
    label: "My Tasks",
    icon: ListChecks,
    key: "tasks",
    // Work assigned but not yet looked at. New tasks arrive as pending, so the
    // dot sits there; the group carries it too while the group is collapsed.
    children: [
      { label: "Today's Tasks", to: "/employee/tasks/today" },
      { label: "Pending", to: "/employee/tasks/pending", dot: newTasks > 0 },
      { label: "Completed", to: "/employee/tasks/completed" },
      { label: "Task Details", to: "/employee/tasks/details" },
    ],
  },

  { label: "Daily Work", to: "/employee/daily-work", icon: ClipboardList },
  { label: "Submit Work", to: "/employee/submit-work", icon: SendHorizontal },
  { label: "Work History", to: "/employee/history", icon: History },
  { label: "Files", to: "/employee/files", icon: FolderOpen },

  // Mirrors the admin's Code section: projects assigned to this employee,
  // archives sent person to person, and the submit-and-get-approved pipeline.
  {
    label: "Code",
    icon: FileCode,
    key: "code",
    children: [
      { label: "My Projects", to: "/employee/code-projects" },
      { label: "Send / Receive", to: "/employee/code-share" },
      { label: "My Code", to: "/employee/code" },
      { label: "Shared With Me", to: "/employee/code/shared" },
    ],
  },

  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Operations Manager", to: "/employee/chat/operation-manager" },
      { label: "Admin", to: "/employee/chat/admin" },
      ...(clientChatEnabled ? [{ label: "Client", to: "/employee/chat/clients" }] : []),
    ],
  },

  { label: "Issues", to: "/employee/issues", icon: AlertTriangle },
  // Where this employee writes their update for the manager, and reads the
  // reply. Sits by Issues because both are things you raise upwards.
  { label: "My Reports", to: "/employee/reports", icon: ClipboardList },
  { label: "Calendar", to: "/employee/calendar", icon: CalendarDays },
  // Time off: what has been asked for and what HR decided. Sits beside the
  // calendar because that is where somebody looks when planning days out.
  { label: "My Leave", to: "/employee/leave", icon: CalendarCheck },
  // Points earned against deadlines, and what they are worth. Read-only —
  // the score answers to the task list, not to this screen.
  { label: "My Incentive", to: "/employee/incentive", icon: Trophy },
  { label: "Play Store", to: "/employee/play", icon: Store },
  { label: "SEO & Social", to: "/employee/seo", icon: Search },
  { label: "My Team", to: "/employee/my-team", icon: Network },
  { label: "Ads", to: "/employee/ads", icon: Megaphone },
  { label: "Vault", to: "/employee/vault", icon: KeyRound },
  { label: "Notifications", to: "/employee/notifications", icon: Bell, badge: unread },
  { label: "Profile", to: "/employee/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
