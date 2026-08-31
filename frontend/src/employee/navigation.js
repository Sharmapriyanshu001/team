import {
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
  MessagesSquare,
  AlertTriangle,
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

  // Everything a team leader has handed over — the project, the task and the
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
      { label: "Team Leader", to: "/employee/chat/team-leader" },
      { label: "Admin", to: "/employee/chat/admin" },
      ...(clientChatEnabled ? [{ label: "Client", to: "/employee/chat/clients" }] : []),
    ],
  },

  { label: "Issues", to: "/employee/issues", icon: AlertTriangle },
  { label: "Calendar", to: "/employee/calendar", icon: CalendarDays },
  { label: "Play Store", to: "/employee/play", icon: Store },
  { label: "SEO & Social", to: "/employee/seo", icon: Search },
  { label: "Notifications", to: "/employee/notifications", icon: Bell, badge: unread },
  { label: "Profile", to: "/employee/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
