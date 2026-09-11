import {
  Trophy,
  BarChart3,
  LayoutDashboard,
  Inbox,
  FolderKanban,
  ListChecks,
  ClipboardList,
  SendHorizontal,
  History,
  FolderOpen,
  FileCode,
  Network,
  MessagesSquare,
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  Bell,
  Settings,
  LogOut,
} from "lucide-react";

import { toolItems } from "../shared/navTools";

/**
 * Sidebar for the employee panel.
 *
 * Grouped rather than flat. Twenty-odd entries in one unbroken column is a
 * list people stop reading at about the sixth item, and the things an employee
 * opens every day — their work, their tasks, their leave — were scattered
 * through it with no shape to navigate by. The sections are the shape: each
 * one answers a different question, so finding "My Leave" is a matter of
 * knowing it is about time rather than scanning for the word.
 *
 * Nothing was dropped in the regrouping. Everything that was reachable before
 * is reachable now, in the section it belongs to.
 *
 * The Client chat tab only appears when the admin has enabled it, and the
 * Tools section only holds the screens this account has actually been given
 * work in — see the note on it below.
 */
export const buildNavItems = ({
  clientChatEnabled = false,
  tools = {},
  unread = 0,
  newTasks = 0,
  onLogout,
} = {}) => [
  { label: "Dashboard", to: "/employee/dashboard", icon: LayoutDashboard },

  { section: "Work" },
  // Everything an operations manager has handed over — the project, the task and the
  // code that came with it — in one place, so being given something is
  // noticed rather than discovered on a third screen.
  { label: "My Work", to: "/employee/my-work", icon: Inbox, dot: newTasks > 0 },
  {
    label: "My Tasks",
    icon: ListChecks,
    key: "tasks",
    // Work assigned but not yet looked at. New tasks arrive as pending, so the
    // dot sits there; the group carries it too while the group is collapsed.
    children: [
      { label: "Today's Tasks", to: "/employee/tasks/today" },
      { label: "Pending", to: "/employee/tasks/pending", dot: newTasks > 0 },
      { label: "In Progress", to: "/employee/tasks/in-progress" },
      { label: "Waiting for Review", to: "/employee/tasks/review" },
      { label: "Completed", to: "/employee/tasks/completed" },
      { label: "Task Details", to: "/employee/tasks/details" },
    ],
  },
  { label: "Daily Work", to: "/employee/daily-work", icon: ClipboardList },
  { label: "Submit Work", to: "/employee/submit-work", icon: SendHorizontal },
  { label: "Work History", to: "/employee/history", icon: History },

  { section: "Projects" },
  {
    label: "My Projects",
    icon: FolderKanban,
    key: "projects",
    children: [
      { label: "Active Projects", to: "/employee/projects/active" },
      { label: "Completed Projects", to: "/employee/projects/completed" },
      { label: "Project Details", to: "/employee/projects/details" },
      // Changes a client asked for on a project this person is on
      { label: "Client Changes", to: "/employee/change-requests" },
    ],
  },
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
  { label: "Files", to: "/employee/files", icon: FolderOpen },

  { section: "Communication" },
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
  { label: "Notifications", to: "/employee/notifications", icon: Bell, badge: unread },
  { label: "Issues", to: "/employee/issues", icon: AlertTriangle },

  { section: "People" },
  { label: "My Team", to: "/employee/my-team", icon: Network },

  { section: "Time" },
  { label: "Calendar", to: "/employee/calendar", icon: CalendarDays },
  // Time off: what has been asked for and what HR decided. Sits beside the
  // calendar because that is where somebody looks when planning days out.
  { label: "My Leave", to: "/employee/leave", icon: CalendarCheck },

  { section: "Reports" },
  // Where this employee writes their update for the manager, and reads the
  // reply. Sits by the incentive score because both are how this person's work
  // gets read back to them.
  { label: "My Reports", to: "/employee/reports", icon: BarChart3 },
  // Points earned against deadlines, and what they are worth. Read-only —
  // the score answers to the task list, not to this screen.
  { label: "My Incentive", to: "/employee/incentive", icon: Trophy },

  /**
   * The specialist screens, and only the ones this person has work in.
   *
   * None of these four is a permission — each is a list of records somebody
   * was assigned to, one at a time. An employee on the operations floor is
   * assigned none of them, and four entries leading to four empty screens is
   * worse than no entries: an empty screen reads as something broken, and
   * four of them teach people to stop trusting the menu. Somebody doing the
   * ad accounts or the SEO work gets exactly the ones they were given.
   *
   * The server answers this on /me from the same queries the screens
   * themselves run, so the menu and the page behind it cannot disagree. The
   * section heading goes with them — a heading over nothing is still clutter.
   */
  ...toolItems(tools, "/employee"),

  { section: "Account" },
  { label: "Profile & Settings", to: "/employee/profile", icon: Settings },
  { label: "Logout", icon: LogOut, action: onLogout },
];
