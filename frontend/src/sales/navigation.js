import {
  LayoutDashboard,
  Target,
  PhoneCall,
  ClipboardList,
  FileText,
  Building2,
  TrendingUp,
  IndianRupee,
  UsersRound,
  ListChecks,
  PackageCheck,
  BarChart3,
  CalendarDays,
  Bell,
  User,
} from "lucide-react";

/**
 * The Sales panel's sidebar.
 *
 * Sections rather than one long list, because the panel follows the shape of
 * the work: find them, talk to them, price it, close it, then hand it on.
 * Somebody looking for "where do I log the call I just had" should not have to
 * read eighteen labels to find it.
 */

/**
 * Which module each path belongs to, matched on the longest prefix. Kept beside
 * the nav rather than inside it so the item list stays a plain description of
 * the panel — and so a new screen that forgets to declare a module stays
 * visible and is refused by the server, rather than vanishing for everyone.
 */
const MODULE_BY_PATH = [
  ["/sales/leads", "leads"],
  ["/sales/pipeline", "deals"],
  ["/sales/followups", "followups"],
  ["/sales/activities", "activities"],
  ["/sales/requirements", "requirements"],
  ["/sales/quotations", "quotations"],
  ["/sales/clients", "clients"],
  ["/sales/revenue", "revenue"],
  ["/sales/team", "team"],
  ["/sales/tasks", "tasks"],
  ["/sales/projects", "projects"],
  ["/sales/reports", "reports"],
  ["/sales/dashboard", "dashboard"],
].sort((a, b) => b[0].length - a[0].length);

const moduleFor = (to) => MODULE_BY_PATH.find(([prefix]) => to?.startsWith(prefix))?.[1] || null;

/**
 * The sidebar this account should see. A section header is dropped when
 * nothing under it survived, so an executive does not get a "Team" heading
 * with nothing beneath it.
 *
 * This is presentation. The server refuses the same requests either way, and
 * the row-level scoping is applied in the queries regardless.
 */
export const visibleNavItems = (items, can) => {
  const kept = items
    .map((item) => {
      if (item.section) return item;
      if (item.action || !item.to) return item;

      const module = moduleFor(item.to);
      return !module || can(module, "view") ? item : null;
    })
    .filter(Boolean);

  // Drop a heading with nothing left under it
  return kept.filter((item, i) => {
    if (!item.section) return true;
    const next = kept[i + 1];
    return next && !next.section;
  });
};

/**
 * The sidebar, built for this account rather than declared flat.
 *
 * Two things vary. The red dot on Tasks says work landed since they last
 * looked, which is a live number and cannot be a constant. And the label on
 * that same entry differs by role — a manager's Tasks screen is a list of
 * what they handed out, an executive's is a list of what they were handed,
 * and calling both of them the same thing makes the manager's screen read as
 * a personal to-do list.
 */
export const navItemsFor = ({ newTasks = 0, isSalesHead = false } = {}) => [
  { label: "Dashboard", to: "/sales/dashboard", icon: LayoutDashboard },

  { section: "Pipeline" },
  { label: "Leads", to: "/sales/leads", icon: Target },
  // The same records as Leads, drawn as a board. Sales people think in
  // columns; a table is for finding one person, a board is for reading the week.
  { label: "Deal Pipeline", to: "/sales/pipeline", icon: TrendingUp },
  { label: "Follow-ups", to: "/sales/followups", icon: PhoneCall },

  { section: "Commercial" },
  { label: "Requirements", to: "/sales/requirements", icon: ClipboardList },
  { label: "Quotations", to: "/sales/quotations", icon: FileText },
  { label: "Clients", to: "/sales/clients", icon: Building2 },
  // What was sold, handed to Operations, and how it is actually going
  { label: "Delivery", to: "/sales/projects", icon: PackageCheck },
  { label: "Revenue", to: "/sales/revenue", icon: IndianRupee },

  { section: "Team" },
  // Head only — the route behind it refuses an executive, and the entry is
  // left out for them so the panel does not offer a door that will not open.
  { label: "Sales Team", to: "/sales/team", icon: UsersRound },
  {
    label: isSalesHead ? "Team Tasks" : "My Tasks",
    to: "/sales/tasks",
    icon: ListChecks,
    dot: newTasks > 0,
  },
  { label: "Reports", to: "/sales/reports", icon: BarChart3 },

  { section: "Account" },
  // Ungated on purpose, like the route behind it: an inbox is how this account
  // is told what is happening to it, not a section that can be withheld.
  // Their own time off. Goes to HR and the administrators to decide.
  { label: "My Leave", to: "/sales/leave", icon: CalendarDays },
  { label: "Notifications", to: "/sales/notifications", icon: Bell },
  { label: "Profile", to: "/sales/profile", icon: User },
];
