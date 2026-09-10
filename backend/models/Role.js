import mongoose from "mongoose";

// Every module the sidebar exposes — permissions are stored per module.
export const PERMISSION_MODULES = [
  "dashboard",
  "clients",
  "operations_managers",
  "employees",
  // HR's own work, kept apart from the employee directory on purpose: a
  // manager who should see who works here is not automatically somebody who
  // should read everyone's leave reasons or the salary a candidate asked for.
  "leaves",
  "recruitment",
  "projects",
  "tasks",
  "chat",
  "issues",
  "files",
  // The three things "code" means in this app: projects opened in the
  // browser workspace, archives sent person to person, and the review queue.
  "code_projects",
  "code",
  // Play consoles, the apps on them, releases and policy notices
  "play_console",
  // SEO and social retainers: rankings, audits, backlinks, the post calendar
  "seo",
  // Leads, quotations, invoices and payments
  "crm",
  // Paid advertising: Meta and Google accounts, campaigns and spend
  "ads",
  // The studio's own apps and sites — what they earn, cost, and owe partners
  "portfolio",
  // Departments, who is on them, and the numbers they carry
  "teams",
  // The credential vault. Its own module because access to it is a decision
  // about trust, not about which part of the business somebody works in.
  "vault",
  "reports",
  "activity_logs",
  "roles",
  // Creating and managing the department logins themselves — HR, Sales and
  // Operations accounts. Its own module because handing somebody the ability
  // to mint department accounts is handing them the panel.
  "department_accounts",
  "settings",
];

/**
 * Which department each module belongs to, for the role editor and for the
 * default role each department account is given.
 *
 * A module missing from here is one that belongs to no single department —
 * the dashboard, chat, reports — and is offered to every department.
 */
export const MODULE_DEPARTMENTS = {
  employees: "hr",
  leaves: "hr",
  recruitment: "hr",
  operations_managers: "hr",

  crm: "sales",
  clients: "sales",

  projects: "operations",
  tasks: "operations",
  issues: "operations",
  files: "operations",
  code_projects: "operations",
  code: "operations",
  play_console: "operations",
  seo: "operations",
  ads: "operations",
};

export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"];

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, default: "" },
    // { clients: ["view", "create"], projects: ["view"] }
    permissions: {
      type: Map,
      of: [String],
      default: {},
    },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Role = mongoose.model("Role", roleSchema);

export default Role;
