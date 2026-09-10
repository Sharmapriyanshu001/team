import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

/**
 * The numbers on a person's profile drawer.
 *
 * Both panels show the same card row and read it from the same rollup — see
 * utils/staffRollup.js — so what is asserted here is the shape of the answer
 * and the one judgment inside it: "finished on time" is unanswerable until
 * somebody has finished dated work, and must not report a perfect record in
 * the meantime.
 */

let api;
let stop;
let admin;
let hrHead;

const A = () => ({ token: admin.token });

before(async () => {
  ({ api, stop } = await startHarness({ port: 5919 }));
  admin = await signIn(api, { role: "admin", name: "Founder" });
  hrHead = await signIn(api, { role: "hr", name: "HR Head" });
});

after(async () => {
  await stop();
});

let counter = 0;
const hire = async () => {
  counter += 1;
  const person = {
    name: `Drawer Subject ${counter}`,
    email: `drawer-${counter}@example.com`,
    phone: `95000000${String(10 + counter).slice(-2)}`,
    designation: "Site Engineer",
    department: "Execution",
  };

  const res = await api.post("/api/admin/employees", person, A());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item;
};

describe("a staff record's work numbers", () => {
  test("a new hire reads as nothing done rather than everything done", async () => {
    const person = await hire();

    const res = await api.get(`/api/admin/employees/${person._id}/details`, A());
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const { stats } = res.body;
    assert.equal(stats.projects, 0);
    assert.equal(stats.projectsCompleted, 0);
    assert.equal(stats.tasksOverdue, 0);
    assert.equal(
      stats.onTimeRate,
      null,
      "somebody who has finished no dated work is being credited with a record"
    );
    assert.equal(stats.leaveTakenThisYear, 0);
  });

  test("HR's drawer answers with the same counts", async () => {
    const person = await hire();

    const res = await api.get(`/api/hr/employees/${person._id}/details`, {
      token: hrHead.token,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const { stats } = res.body;
    assert.equal(stats.projects, 0);
    assert.equal(stats.projectsCompleted, 0);
    assert.equal(stats.onTimeRate, null);

    /**
     * Counts, and only counts. Nothing under /api/hr answers with a project,
     * and this route must not be where that changes.
     */
    assert.equal(res.body.projects, undefined, "the HR panel was handed project rows");
  });

  test("a project the person is on is counted, and counted as complete when it is", async () => {
    const person = await hire();

    const created = await api.post(
      "/api/admin/projects",
      { name: `Drawer Project ${counter}`, members: [person._id], status: "in_progress" },
      A()
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const running = await api.get(`/api/admin/employees/${person._id}/details`, A());
    assert.equal(running.body.stats.projects, 1);
    assert.equal(running.body.stats.projectsActive, 1);
    assert.equal(running.body.stats.projectsCompleted, 0);

    const done = await api.put(
      `/api/admin/projects/${created.body.item._id}`,
      { status: "completed" },
      A()
    );
    assert.equal(done.status, 200, JSON.stringify(done.body));

    const after = await api.get(`/api/admin/employees/${person._id}/details`, A());
    assert.equal(after.body.stats.projects, 1);
    assert.equal(after.body.stats.projectsActive, 0);
    assert.equal(after.body.stats.projectsCompleted, 1);
  });
});
