import mongoose from "mongoose";

// Every module the sidebar exposes — permissions are stored per module.
export const PERMISSION_MODULES = [
  "dashboard",
  "clients",
  "team_leaders",
  "employees",
  "projects",
  "tasks",
  "chat",
  "issues",
  "files",
  // The three things "code" means in this app: projects opened in the
  // browser workspace, archives sent person to person, and the review queue.
  "code_projects",
  "code",
  "reports",
  "activity_logs",
  "roles",
  "settings",
];

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
