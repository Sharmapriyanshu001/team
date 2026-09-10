import {
  LayoutDashboard,
  FolderKanban,
  Gauge,
  FolderOpen,
  MessagesSquare,
  Star,
  MessageSquarePlus,
  CalendarClock,
  Bell,
  User,
  LogOut,
} from "lucide-react";

/**
 * Sidebar for the client portal.
 * The Operations Manager and Employees chat tabs only appear when the admin has
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
      ...(leaderChatEnabled ? [{ label: "Operations Manager", to: "/client/chat/operation-manager" }] : []),
      ...(employeeChatEnabled ? [{ label: "Employees", to: "/client/chat/employees" }] : []),
    ],
  },

  // Ask for a change, and follow what happens to it. Above Feedback because
  // a request is something you are waiting on; feedback is something you leave.
  { label: "Change Requests", to: "/client/requests", icon: MessageSquarePlus },

  { label: "Feedback", to: "/client/feedback", icon: Star },
  { label: "Meetings", to: "/client/meetings", icon: CalendarClock },
  { label: "Notifications", to: "/client/notifications", icon: Bell, badge: unread },
  { label: "Profile", to: "/client/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
