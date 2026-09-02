import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let salesHead;
let salesExec;
let devExec;

const T = () => ({ token: admin.token });

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;

before(async () => {
  ({ api, stop } = await startHarness({ port: 5913 }));
  admin = await signIn(api, { role: "admin", name: "Founder" });
  salesHead = await signIn(api, { role: "employee", name: "Sales Head" });
  salesExec = await signIn(api, { role: "employee", name: "Sales Exec" });
  devExec = await signIn(api, { role: "employee", name: "Developer" });
});

after(async () => {
  await stop();
});

const makeTeam = async (overrides = {}) => {
  const res = await api.post(
    "/api/admin/teams",
    { name: "A team", kind: "operations", ...overrides },
    T()
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item;
};

describe("teams", () => {
  test("making somebody a manager gives them the role", async () => {
    const team = await makeTeam({
      name: "Sales",
      kind: "sales",
      manager: salesHead.user._id,
      members: [salesExec.user._id],
    });

    assert.equal(String(team.manager._id), String(salesHead.user._id));

    const { default: User } = await import("../models/User.js");
    const updated = await User.findById(salesHead.user._id);
    assert.equal(updated.role, "manager", "a department head is not an ordinary employee");
  });

  test("a manager can sign in to the team leader panel", async () => {
    const res = await api.post(
      "/api/leader/login",
      { email: salesHead.user.email, password: "test-password-1" },
      T()
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.token);
  });

  test("somebody cannot be a leader and a member of the same team at once", async () => {
    const team = await makeTeam({
      name: "Operations",
      kind: "operations",
      teamLeaders: [devExec.user._id],
      members: [devExec.user._id, salesExec.user._id],
    });

    assert.equal(team.teamLeaders.length, 1);
    assert.equal(team.members.length, 1, "the duplicate was dropped from members");
    assert.equal(String(team.members[0]._id), String(salesExec.user._id));
  });

  test("being made a team leader promotes an employee", async () => {
    const { default: User } = await import("../models/User.js");
    const updated = await User.findById(devExec.user._id);
    assert.equal(updated.role, "team_leader");
  });

  test("a manager is never demoted by being added as a member elsewhere", async () => {
    await makeTeam({ name: "Side project", members: [salesHead.user._id] });

    const { default: User } = await import("../models/User.js");
    const updated = await User.findById(salesHead.user._id);
    assert.equal(updated.role, "manager", "still a manager");
  });
});

describe("targets that count themselves", () => {
  let salesTeamId;
  let clientId;

  before(async () => {
    const list = await api.get("/api/admin/teams", T());
    salesTeamId = list.body.items.find((row) => row.name === "Sales")._id;

    const { default: Client } = await import("../models/Client.js");
    const client = await Client.create({ name: "Buyer", email: "buyer@example.com" });
    clientId = String(client._id);
  });

  test("a target needs an owner, a metric and a number", async () => {
    for (const body of [
      { metric: "revenue_closed", targetValue: 100000 },
      { team: salesTeamId, targetValue: 100000 },
      { team: salesTeamId, metric: "revenue_closed", targetValue: 0 },
    ]) {
      const res = await api.post("/api/admin/targets", body, T());
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test("the same target cannot be set twice for one month", async () => {
    const first = await api.post(
      "/api/admin/targets",
      { team: salesTeamId, metric: "revenue_closed", targetValue: 500000, year: YEAR, month: MONTH },
      T()
    );
    assert.equal(first.status, 201);

    const again = await api.post(
      "/api/admin/targets",
      { team: salesTeamId, metric: "revenue_closed", targetValue: 600000, year: YEAR, month: MONTH },
      T()
    );
    assert.equal(again.status, 409);
    assert.match(again.body.message, /edit it instead/i);
  });

  test("invoicing raises the team's revenue figure with nobody totalling anything", async () => {
    const before = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}`, T());
    const start = before.body.items.find((row) => row.metric === "revenue_closed");
    assert.equal(start.actual, 0);
    assert.equal(start.auto, true, "this one counts itself");

    // The founder raises it here; the manager is who the target is measured on,
    // so the invoice is created by them
    const managerLogin = await api.post(
      "/api/leader/login",
      { email: salesHead.user.email, password: "test-password-1" },
      T()
    );
    assert.ok(managerLogin.body.token);

    const { default: Invoice } = await import("../models/Invoice.js");
    await Invoice.create({
      number: `INV/TEST/0001`,
      client: clientId,
      total: 120000,
      status: "sent",
      issuedOn: new Date(),
      createdBy: salesHead.user._id,
    });

    const after = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}`, T());
    const row = after.body.items.find((r) => r.metric === "revenue_closed");

    assert.equal(row.actual, 120000, "read straight off the invoices");
    assert.equal(row.percent, 24);
    assert.equal(row.remaining, 380000);
  });

  test("a personal target measures only that person", async () => {
    const res = await api.post(
      "/api/admin/targets",
      {
        team: salesTeamId,
        owner: salesExec.user._id,
        metric: "leads_won",
        targetValue: 5,
        year: YEAR,
        month: MONTH,
      },
      T()
    );
    assert.equal(res.status, 201);

    const { default: Lead } = await import("../models/Lead.js");
    await Lead.create({ name: "Closed one", owner: salesExec.user._id, stage: "won", wonAt: new Date() });
    await Lead.create({ name: "Somebody else's", owner: devExec.user._id, stage: "won", wonAt: new Date() });

    const list = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}`, T());
    const personal = list.body.items.find((row) => row.metric === "leads_won");

    assert.equal(personal.actual, 1, "the developer's win is not the sales exec's");
  });

  test("a metric nothing counts is typed in, and says so", async () => {
    const team = await makeTeam({ name: "HR", kind: "hr" });

    const made = await api.post(
      "/api/admin/targets",
      { team: team._id, metric: "hires_made", targetValue: 3, year: YEAR, month: MONTH },
      T()
    );
    assert.equal(made.status, 201);

    const list = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}&team=${team._id}`, T());
    const row = list.body.items.find((r) => r.metric === "hires_made");

    assert.equal(row.auto, false, "nothing in this app counts hiring");
    assert.equal(row.actual, 0);

    const updated = await api.put(`/api/admin/targets/${made.body.item._id}`, { manualValue: 2 }, T());
    assert.equal(updated.status, 200);

    const after = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}&team=${team._id}`, T());
    assert.equal(after.body.items.find((r) => r.metric === "hires_made").actual, 2);
  });

  test("a custom metric has to say what it is", async () => {
    const team = await makeTeam({ name: "Odd jobs" });
    const res = await api.post(
      "/api/admin/targets",
      { team: team._id, metric: "custom", targetValue: 10, year: YEAR, month: MONTH },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /what this number actually is/i);
  });

  test("progress is judged against how far through the month it is", async () => {
    const list = await api.get(`/api/admin/targets?year=${YEAR}&month=${MONTH}`, T());
    const row = list.body.items.find((r) => r.metric === "revenue_closed");

    // 24% of the target, against the share of the month that has gone
    const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
    const expected = (new Date().getDate() / daysInMonth) * 100;

    assert.equal(row.onTrack, row.percent >= expected);
  });
});

describe("the team screen", () => {
  test("it shows the team's targets, its people and their own", async () => {
    const list = await api.get("/api/admin/teams", T());
    const sales = list.body.items.find((row) => row.name === "Sales");

    const res = await api.get(`/api/admin/teams/${sales._id}/detail`, T());
    assert.equal(res.status, 200);

    assert.equal(res.body.item.name, "Sales");
    assert.ok(res.body.targets.length >= 1, "the team's own targets");

    const exec = res.body.people.find((person) => person.name === "Sales Exec");
    assert.ok(exec, "members are listed");
    assert.equal(exec.targets.length, 1, "with the targets they personally carry");
  });

  test("the overview leads with how each team is doing", async () => {
    const res = await api.get("/api/admin/teams/overview", T());
    assert.equal(res.status, 200);

    const sales = res.body.teams.find((row) => row.name === "Sales");
    assert.equal(sales.kind, "sales");
    assert.ok(sales.headcount >= 2);
    assert.equal(sales.manager.name, "Sales Head");
    assert.ok(sales.targets.length >= 1);
    assert.ok(Array.isArray(res.body.metrics), "the form's option list comes with it");
  });
});

describe("what a team member sees", () => {
  test("an employee sees their team and their own targets", async () => {
    const res = await api.get("/api/employee/team/mine", { token: salesExec.token });
    assert.equal(res.status, 200);

    assert.ok(res.body.teams.some((team) => team.name === "Sales"));
    assert.equal(res.body.mine.length, 1, "the one they carry");
    assert.equal(res.body.mine[0].metric, "leads_won");
    assert.ok(res.body.teamTargets.length >= 1, "and what the team as a whole is aiming at");
  });

  test("somebody on no team sees nothing rather than everything", async () => {
    const nobody = await signIn(api, { role: "employee", name: "New Joiner" });

    const res = await api.get("/api/employee/team/mine", { token: nobody.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.teams.length, 0);
    assert.equal(res.body.mine.length, 0);
  });
});

describe("work that is not project work", () => {
  test("a task can belong to a team instead of a project", async () => {
    const list = await api.get("/api/admin/teams", T());
    const hr = list.body.items.find((row) => row.name === "HR");

    const { default: Task } = await import("../models/Task.js");
    const task = await Task.create({
      title: "Collect Aadhaar from the new joiner",
      team: hr._id,
      assignedTo: salesExec.user._id,
      status: "pending",
    });

    assert.ok(task.team, "hiring work has a home now");
    assert.equal(task.project, undefined, "and needs no client project to exist");
  });
});

describe("a manager does not fall through the cracks", () => {
  /**
   * The regression this guards against: promoting somebody to manager changes
   * their role, and every staff list in the panel is scoped by role. Without a
   * managers list and a managers entry in the lookups, a new department head
   * would disappear from the panel the moment they were made one.
   */
  test("a promoted manager turns up in the managers list", async () => {
    const res = await api.get("/api/admin/managers", T());
    assert.equal(res.status, 200);
    assert.ok(
      res.body.items.some((row) => row.name === "Sales Head"),
      "the account promoted by being made a team's manager"
    );
  });

  test("and is still offered in every dropdown in the panel", async () => {
    const res = await api.get("/api/admin/lookups", T());
    assert.equal(res.status, 200);

    assert.ok(
      res.body.staff.some((person) => person.name === "Sales Head"),
      "a promoted manager must stay assignable — to a task, a lead, another team"
    );
    assert.ok(res.body.managers.some((person) => person.name === "Sales Head"));
  });

  test("the managers list holds only managers", async () => {
    const res = await api.get("/api/admin/managers", T());
    const roles = new Set(res.body.items.map((row) => row.role));
    assert.deepEqual([...roles], ["manager"]);
  });

  test("hiring one directly asks for the same paperwork as any other staff", async () => {
    const res = await api.post(
      "/api/admin/managers",
      { name: "Ops Head", email: "opshead@example.com", phone: "9812345678" },
      T()
    );

    assert.equal(res.status, 400, "no Aadhaar, no account — the same rule team leaders follow");
    assert.match(res.body.message, /Aadhaar/i);
  });

  test("a team leader is not shown in the managers list", async () => {
    const res = await api.get("/api/admin/managers", T());
    assert.ok(!res.body.items.some((row) => row.name === "Developer"));

    const leaders = await api.get("/api/admin/team-leaders", T());
    assert.ok(leaders.body.items.some((row) => row.name === "Developer"));
  });
});
