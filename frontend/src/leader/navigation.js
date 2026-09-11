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
  MessagesSquare,
  AlertTriangle,
  CalendarDays,
  Bell,
  BarChart3,
  User,
  LogOut,
} from "lucide-react";

import { toolItems } from "../shared/navTools";

/**
 * Sidebar for the operations manager panel.
 * `clientChatEnabled` comes from the admin's settings — when it is off, the
 * Chat group drops its Client tab entirely. `tools` is the same idea for the
 * four specialist screens: a manager who runs none of the ad accounts, SEO
 * engagements, consoles or vault credentials is shown none of them.
 */
export const buildNavItems = ({
  clientChatEnabled = false,
  tools = {},
  unread = 0,
  newTasks = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/operation-manager/dashboard", icon: LayoutDashboard },

  { section: "Work" },

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
  // "My Projects" and "Tasks" because that is the order the work happens in.
  { label: "Assign Work", to: "/operation-manager/assign-work", icon: UserPlus },
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

  { section: "Team" },

  /**
   * "My Team" sits inside this group rather than beside it, and is kept
   * rather than dropped as a duplicate of "Team Members": the two answer
   * different questions. Team Members is the roster — who is on the team, and
   * adding or removing them. My Team is this month's targets and how the team
   * is tracking against them, drawn with the same Progress bar the admin sees.
   * Removing it would take the targets view away with it.
   */
  {
    label: "Team",
    icon: UsersRound,
    key: "team",
    children: [
      { label: "Team Members", to: "/operation-manager/team" },
      { label: "Member Details", to: "/operation-manager/team/member" },
      { label: "Performance", to: "/operation-manager/team/performance" },
      { label: "Targets", to: "/operation-manager/my-team" },
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

  { section: "Management" },

  { label: "Issues", to: "/operation-manager/issues", icon: AlertTriangle },
  { label: "Files", to: "/operation-manager/files", icon: FolderOpen },
  /**
   * Kept, deliberately.
   *
   * This is not admin-style code management — it is the review queue for work
   * this manager's own team submits to them, plus the archives they hand back
   * down. Dropping the group would hide a decision only this account can make,
   * and the dashboard's "code submissions to review" row would point at a
   * page with no way to reach it.
   */
  {
    label: "Code",
    icon: FileCode,
    key: "code",
    children: [
      { label: "Code Reviews", to: "/operation-manager/code-reviews" },
      { label: "My Projects", to: "/operation-manager/code-projects" },
      { label: "Send / Receive", to: "/operation-manager/code-share" },
      { label: "Shared Code", to: "/operation-manager/code" },
    ],
  },
  // Only the specialist screens this manager actually runs — see navTools
  ...toolItems(tools, "/operation-manager", { section: null }),

  { section: "Time" },

  { label: "Calendar", to: "/operation-manager/calendar", icon: CalendarDays },
  // Their own time off. Goes to HR and the administrators to decide.
  { label: "My Leave", to: "/operation-manager/leave", icon: CalendarDays },
  // The rules a manager is approving leave against. Read-only — HR writes them.
  { label: "Leave Policies", to: "/operation-manager/leave-policies", icon: ClipboardList },

  { section: "Reports" },

  { label: "Team Reports", to: "/operation-manager/reports", icon: BarChart3 },
  // The team files its updates here and the manager answers them, then sends
  // one team update up to HR.
  { label: "Report Chain", to: "/operation-manager/report-chain", icon: ClipboardList },

  { section: "Account" },

  { label: "Notifications", to: "/operation-manager/notifications", icon: Bell, badge: unread },
  { label: "Profile", to: "/operation-manager/profile", icon: User },
  { label: "Logout", icon: LogOut, action: onLogout },
];
