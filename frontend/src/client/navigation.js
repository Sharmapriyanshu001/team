import {
  LayoutDashboard,
  FolderKanban,
  Gauge,
  FolderOpen,
  MessagesSquare,
  Star,
  CalendarClock,
  Bell,
  User,
  LogOut,
} from "lucide-react";

/**
 * Sidebar for the client portal.
 * The Team Leader and Employees chat tabs only appear when the admin has
 * switched them on in Settings.
 */
export const buildNavItems = ({
  leaderChatEnabled = false,
  employeeChatEnabled = false,
  unread = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/client/dashboard", icon: LayoutDashboard },

  { label: "My Projects", to: "/client/projects", icon: FolderKanban },
  { label: "Project Progress", to: "/client/progress", icon: Gauge },
  { label: "Files", to: "/client/files", icon: FolderOpen },

  {
    label: "Chat",
    icon: MessagesSquare,
    key: "chat",
    children: [
      { label: "Admin", to: "/client/chat/admin" },
      ...(leaderChatEnabled ? [{ label: "Team Leader", to: "/client/chat/team-leader" }] : []),
      ...(employeeChatEnabled ? [{ label: "Employees", to: "/client/chat/employees" }] : []),
    ],
  },

  { label: "Feedback", to: "/client/feedback", icon: Star },
  { label: "Meetings", to: "/client/meetings", icon: CalendarClock },
  { label: "Notifications", to: "/client/notifications", icon: Bell, badge: unread },
  { label: "Profile", to: "/client/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
