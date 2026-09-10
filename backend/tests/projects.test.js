import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

/**
 * "Have we built this before?", asked as a project is created.
 *
 * Half of what this company is asked for is work it has done already, and the
 * person being asked again is not always the person who did it. The answer
 * used to live in somebody's memory; now it lives on the project.
 *
 * The tests below are about the answer still meaning something a year later:
 * a yes carries a link, a no leaves nothing behind it, a link is stored in a
 * state somebody can actually click, and editing the budget does not quietly
 * erase any of it.
 */

let api;
let stop;
let admin;

const T = () => ({ token: admin.token });

before(async () => {
  ({ api, stop } = await startHarness({ port: 5917 }));
  admin = await signIn(api, { role: "admin", name: "Founder" });
});

after(async () => {
  await stop();
});

let counter = 0;
const newProject = (overrides = {}) => {
  counter += 1;
  return { name: `Project ${counter}`, ...overrides };
};

const create = (body) => api.post("/api/admin/projects", body, T());

describe("a project remembers whether it was built before", () => {
  test("a yes keeps the link, with the scheme filled in", async () => {
    const res = await create(
      newProject({
        existingWork: { builtBefore: true, link: "acme.com/green-valley", note: "Same layout" },
      })
    );

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.existingWork.builtBefore, true);
    assert.equal(res.body.item.existingWork.link, "https://acme.com/green-valley");
    assert.equal(res.body.item.existingWork.note, "Same layout");
  });

  test("a link that already has a scheme is left exactly as pasted", async () => {
    const link = "http://staging.acme.com/build?v=2";
    const res = await create(newProject({ existingWork: { builtBefore: true, link } }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.existingWork.link, link);
  });

  test("a link into this panel stays a path", async () => {
    const link = "/admin/projects/652f1c2a4b1e8a0012345678";
    const res = await create(newProject({ existingWork: { builtBefore: true, link } }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(
      res.body.item.existingWork.link,
      link,
      "a path was rewritten as a hostname and stopped working"
    );
  });

  test("a yes with nothing pasted after it is refused", async () => {
    const res = await create(newProject({ existingWork: { builtBefore: true, link: "   " } }));

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /link/i);
  });

  test("something that is not a link is refused", async () => {
    const res = await create(
      newProject({ existingWork: { builtBefore: true, link: "ask Rahul about it" } })
    );

    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("a no leaves no link under it", async () => {
    const res = await create(
      newProject({ existingWork: { builtBefore: false, link: "https://acme.com/old" } })
    );

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.existingWork.builtBefore, false);
    assert.equal(res.body.item.existingWork.link, "");
  });

  test("a project nobody was asked about says nothing either way", async () => {
    const res = await create(newProject());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(
      res.body.item.existingWork?.builtBefore ?? null,
      null,
      "an unanswered project is claiming to be new work"
    );
  });

  test("editing another field leaves the answer alone", async () => {
    const created = await create(
      newProject({ existingWork: { builtBefore: true, link: "https://acme.com/old" } })
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const edited = await api.put(
      `/api/admin/projects/${created.body.item._id}`,
      { budget: 250000 },
      T()
    );

    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.item.budget, 250000);
    assert.equal(edited.body.item.existingWork.link, "https://acme.com/old");
    assert.equal(edited.body.item.existingWork.builtBefore, true);
  });

  test("the answer can be changed later, and changing it to no clears the link", async () => {
    const created = await create(
      newProject({ existingWork: { builtBefore: true, link: "https://acme.com/old" } })
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const edited = await api.put(
      `/api/admin/projects/${created.body.item._id}`,
      { existingWork: { builtBefore: false } },
      T()
    );

    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.item.existingWork.builtBefore, false);
    assert.equal(edited.body.item.existingWork.link, "");
  });
});
