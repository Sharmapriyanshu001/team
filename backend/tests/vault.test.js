import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let employee;
let outsider;

const T = () => ({ token: admin.token });

before(async () => {
  ({ api, stop } = await startHarness({ port: 5907 }));
  admin = await signIn(api, { role: "admin", name: "Vault Admin" });
  employee = await signIn(api, { role: "employee", name: "Trusted Dev" });
  outsider = await signIn(api, { role: "employee", name: "Other Dev" });
});

after(async () => {
  await stop();
});

const SECRET = "s3cret-cpanel-pass!";

describe("storing a secret", () => {
  let id;

  test("it is saved and comes back without the secret in it", async () => {
    const res = await api.post(
      "/api/admin/vault",
      {
        label: "Acme cPanel",
        type: "cpanel",
        url: "https://acme.com:2083",
        username: "acmeadmin",
        secret: SECRET,
        notes: "recovery codes: 111 222",
        hint: "the usual one",
      },
      T()
    );

    assert.equal(res.status, 201);
    id = res.body.item._id;

    assert.equal(res.body.item.hasSecret, true);
    assert.equal(res.body.item.secret, undefined, "the response must never carry the secret");
    assert.equal(res.body.item.secretSealed, undefined, "nor the ciphertext");
    assert.equal(res.body.item.notesSealed, undefined);
  });

  test("what is on disk is ciphertext, not the password", async () => {
    const { default: Credential } = await import("../models/Credential.js");
    const raw = await Credential.findById(id).lean();

    assert.ok(raw.secretSealed.startsWith("v1:"), raw.secretSealed.slice(0, 20));
    assert.ok(
      !JSON.stringify(raw).includes(SECRET),
      "the plaintext must not appear anywhere in the stored document"
    );
  });

  test("the list never carries secrets either", async () => {
    const res = await api.get("/api/admin/vault", T());
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 1);
    assert.ok(!JSON.stringify(res.body).includes(SECRET));
    assert.equal(res.body.items[0].hasSecret, true);
  });

  test("revealing hands it over and writes down who looked", async () => {
    const res = await api.post(`/api/admin/vault/${id}/reveal`, {}, T());
    assert.equal(res.status, 200);
    assert.equal(res.body.secret, SECRET);
    assert.match(res.body.notes, /recovery codes/);

    const log = await api.get(`/api/admin/vault/${id}/access-log`, T());
    assert.equal(log.status, 200);
    const revealed = log.body.accessLog.filter((row) => row.action === "revealed");
    assert.equal(revealed.length, 1);
    assert.equal(revealed[0].userName, "Vault Admin");
    assert.ok(revealed[0].at);
  });

  test("an edit that does not mention the secret leaves it alone", async () => {
    const res = await api.put(`/api/admin/vault/${id}`, { label: "Acme cPanel (prod)" }, T());
    assert.equal(res.status, 200);
    assert.equal(res.body.item.hasSecret, true);

    const revealed = await api.post(`/api/admin/vault/${id}/reveal`, {}, T());
    assert.equal(revealed.body.secret, SECRET, "correcting a label must not wipe the password");
  });

  test("rotating replaces it and records when", async () => {
    const res = await api.put(`/api/admin/vault/${id}`, { secret: "brand-new-password" }, T());
    assert.equal(res.status, 200);
    assert.ok(res.body.item.lastRotatedAt);

    const revealed = await api.post(`/api/admin/vault/${id}/reveal`, {}, T());
    assert.equal(revealed.body.secret, "brand-new-password");
  });
});

describe("who may look", () => {
  let sharedId;
  let privateId;

  before(async () => {
    const shared = await api.post(
      "/api/admin/vault",
      {
        label: "Shared hosting",
        type: "hosting",
        secret: "shared-pass",
        sharedWith: [employee.user._id],
      },
      T()
    );
    sharedId = shared.body.item._id;

    const kept = await api.post(
      "/api/admin/vault",
      { label: "Bank portal", type: "other", secret: "very-private" },
      T()
    );
    privateId = kept.body.item._id;
  });

  test("an employee sees only what was shared with them", async () => {
    const res = await api.get("/api/employee/vault", { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].label, "Shared hosting");
    assert.ok(!JSON.stringify(res.body).includes("shared-pass"));
  });

  test("and can reveal that one", async () => {
    const res = await api.post(`/api/employee/vault/${sharedId}/reveal`, {}, { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.secret, "shared-pass");
  });

  test("their name lands in the access log", async () => {
    const log = await api.get(`/api/admin/vault/${sharedId}/access-log`, T());
    const names = log.body.accessLog.map((row) => row.userName);
    assert.ok(names.includes("Trusted Dev"));
  });

  test("an employee cannot reveal one that was not shared with them", async () => {
    const res = await api.post(`/api/employee/vault/${privateId}/reveal`, {}, { token: employee.token });
    assert.equal(res.status, 403);
    assert.ok(!JSON.stringify(res.body).includes("very-private"));
  });

  test("nor can a different employee touch somebody else's share", async () => {
    const list = await api.get("/api/employee/vault", { token: outsider.token });
    assert.equal(list.body.items.length, 0);

    const res = await api.post(`/api/employee/vault/${sharedId}/reveal`, {}, { token: outsider.token });
    assert.equal(res.status, 403);
  });

  test("staff cannot reach the admin's vault routes at all", async () => {
    const res = await api.get("/api/admin/vault", { token: employee.token });
    assert.equal(res.status, 403);
  });

  test("an unauthenticated caller gets nowhere", async () => {
    const res = await api.post(`/api/admin/vault/${sharedId}/reveal`, {});
    assert.equal(res.status, 401);
  });
});

describe("the encryption itself", () => {
  test("a tampered ciphertext fails loudly instead of returning something", async () => {
    const made = await api.post(
      "/api/admin/vault",
      { label: "Tamper test", secret: "original-value" },
      T()
    );

    const { default: Credential } = await import("../models/Credential.js");
    const row = await Credential.findById(made.body.item._id);
    // Flip the last four characters of the ciphertext
    row.secretSealed = row.secretSealed.slice(0, -4) + "AAAA";
    await row.save();

    const res = await api.post(`/api/admin/vault/${made.body.item._id}/reveal`, {}, T());
    assert.equal(res.status, 500);
    assert.match(res.body.message, /could not be decrypted/i);
  });

  test("an empty secret stays empty rather than encrypting nothing", async () => {
    const res = await api.post("/api/admin/vault", { label: "Just a note", hint: "no login" }, T());
    assert.equal(res.status, 201);
    assert.equal(res.body.item.hasSecret, false);
  });

  test("a vault entry needs a name", async () => {
    const res = await api.post("/api/admin/vault", { secret: "orphan" }, T());
    assert.equal(res.status, 400);
  });
});
