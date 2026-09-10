/**
 * Throwaway accounts for the browser driver, and the teardown that removes
 * them again.
 *
 * The live database has one team and it has no manager, so signing in as a
 * real leader would show the reporting screens with nothing in them — which
 * proves only that an empty page renders. This puts a small department in
 * place, with a member update already filed, so the driver sees the screens
 * with something on them.
 *
 * Everything it writes is tagged and deleted by `down`, including the report
 * and the notifications it causes. Nothing existing is touched.
 *
 *   node _driveFixture.mjs up     prints the credentials as shell exports
 *   node _driveFixture.mjs down   removes every trace
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Team from "./models/Team.js";
import Task from "./models/Task.js";
import Report from "./models/Report.js";
import Notification from "./models/Notification.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const TAG = "drivefixture";
const PASSWORD = "9700000000";
const mail = (who) => `${who}.${TAG}@example.com`;

const up = async () => {
  const make = async (role, who, name) => {
    const existing = await User.findOne({ email: mail(who) });
    if (existing) return existing;
    return User.create({
      name: `${name} (fixture)`,
      email: mail(who),
      password: hashPassword(PASSWORD),
      role,
      phone: PASSWORD,
      status: "active",
      designation: name,
    });
  };

  const manager = await make("manager", "manager", "Delivery Manager");
  const member = await make("employee", "member", "Delivery Engineer");

  let team = await Team.findOne({ name: `Delivery (fixture)` });
  if (!team) {
    team = await Team.create({
      name: "Delivery (fixture)",
      kind: "operations",
      description: "A department put here so the reporting screens have shape",
      manager: manager._id,
      members: [member._id],
    });
  }

  // Some work for the department figures to count
  const now = new Date();
  const titles = ["Ship the March release", "Clear the review backlog", "Onboard the new starter"];
  for (const [index, title] of titles.entries()) {
    const exists = await Task.findOne({ title: `${title} (fixture)` });
    if (exists) continue;
    await Task.create({
      title: `${title} (fixture)`,
      team: team._id,
      assignedTo: member._id,
      assignedBy: manager._id,
      status: index === 0 ? "completed" : "in_progress",
      priority: "medium",
    });
  }

  // And an update already sitting in the manager's inbox
  const filed = await Report.findOne({ author: member._id });
  if (!filed) {
    await Report.create({
      kind: "member_update",
      author: member._id,
      authorName: member.name,
      submittedTo: manager._id,
      team: team._id,
      department: "operations",
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      title: "What I did this month",
      summary:
        "Shipped the March release and cleared most of the review backlog. The new starter is set up.",
      highlights: ["March release is out", "Review queue down to three"],
      blockers: ["Still waiting on the staging credentials"],
      status: "submitted",
      submittedAt: now,
    });
  }

  console.log(`export LEADER_EMAIL='${mail("manager")}'`);
  console.log(`export LEADER_PASSWORD='${PASSWORD}'`);
  console.log(`export EMPLOYEE_EMAIL='${mail("member")}'`);
  console.log(`export EMPLOYEE_PASSWORD='${PASSWORD}'`);
};

const down = async () => {
  const people = await User.find({ email: new RegExp(TAG) }).distinct("_id");
  const teams = await Team.find({ name: /\(fixture\)$/ }).distinct("_id");

  const r = {
    reports: (await Report.deleteMany({ author: { $in: people } })).deletedCount,
    tasks: (await Task.deleteMany({ $or: [{ team: { $in: teams } }, { assignedTo: { $in: people } }] }))
      .deletedCount,
    notifications: (await Notification.deleteMany({ user: { $in: people } })).deletedCount,
    teams: (await Team.deleteMany({ _id: { $in: teams } })).deletedCount,
    users: (await User.deleteMany({ _id: { $in: people } })).deletedCount,
  };
  console.log("removed", JSON.stringify(r));
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (process.argv[2] === "down") await down();
  else await up();
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
