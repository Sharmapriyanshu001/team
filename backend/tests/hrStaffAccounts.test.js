import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

/**
 * HR opening a login for senior staff.
 *
 * HR could already open one for a department head (Managers) and for the Sales
 * panel, but not for an operations manager — the person who runs the projects
 * and whom every employee reports to, and so the hire HR makes most often. It
 * was the one account HR had to ask an administrator for.
 *
 * Every test below is about the two panels writing the SAME record. A second
 * definition of what an operations manager is would be the real failure here:
 * an account HR opened that the admin panel could not see, or that signed in
 * somewhere it should not.
 */

let api;
let stop;
let admin;
let hrHead;
let hrManager;

const A = () => ({ token: admin.token });
const H = () => ({ token: hrHead.token });

before(async () => {
  ({ api, stop } = await startHarness({ port: 5915 }));
  admin = await signIn(api, { role: "admin", name: "Founder" });
  hrHead = await signIn(api, { role: "hr", name: "HR Head" });
  hrManager = await signIn(api, { role: "hr_manager", name: "HR Team Member" });
});

after(async () => {
  await stop();
});

let counter = 0;
const newPerson = (overrides = {}) => {
  counter += 1;
  return {
    name: `Ops Manager ${counter}`,
    email: `ops-manager-${counter}@example.com`,
    phone: `98765432${String(10 + counter).slice(-2)}`,
    designation: "Operations Manager",
    department: "Operations",
    ...overrides,
  };
};

const create = async (body, auth = H()) =>
  api.post("/api/hr/operations-managers", body, auth);

describe("HR opens an operations manager's login", () => {
  test("the account is created and can sign in at the operations manager panel", async () => {
    const person = newPerson();
    const res = await create(person);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.role, "operations_manager");
    assert.equal(res.body.item.email, person.email);

    // The password falls back to the mobile number, which is what the screen
    // hands over after a create
    const login = await api.post("/api/leader/login", {
      email: person.email,
      password: person.phone,
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
  });

  test("the role is forced, so the form cannot mint an administrator", async () => {
    const res = await create(newPerson({ role: "admin" }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.role, "operations_manager");

    // And the account it made is refused by the admin panel's door
    const login = await api.post("/api/admin/login", {
      email: res.body.item.email,
      password: res.body.item.phone,
    });
    assert.notEqual(login.status, 200);
  });

  test("the admin panel lists the same person HR just added", async () => {
    const person = newPerson();
    const created = await create(person);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const listed = await api.get("/api/admin/operations-managers?search=" + person.email, A());
    assert.equal(listed.status, 200, JSON.stringify(listed.body));

    const found = (listed.body.items || []).find((row) => row.email === person.email);
    assert.ok(found, "an operations manager HR opened is invisible to the admin panel");
    assert.equal(String(found._id), String(created.body.item._id));
  });

  test("an HR Manager may open one too — the module is shared", async () => {
    const res = await create(newPerson(), { token: hrManager.token });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test("the counts above the table follow the rows", async () => {
    const before = await api.get("/api/hr/operations-managers/summary", H());
    assert.equal(before.status, 200, JSON.stringify(before.body));

    const created = await create(newPerson());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const after = await api.get("/api/hr/operations-managers/summary", H());
    assert.equal(after.body.counts.total, before.body.counts.total + 1);
    assert.equal(after.body.counts.active, before.body.counts.active + 1);
  });

  test("deactivating stops the login, and it is an ordinary status edit", async () => {
    const person = newPerson();
    const created = await create(person);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const edit = await api.put(
      `/api/hr/operations-managers/${created.body.item._id}`,
      { status: "inactive" },
      H()
    );
    assert.equal(edit.status, 200, JSON.stringify(edit.body));

    const login = await api.post("/api/leader/login", {
      email: person.email,
      password: person.phone,
    });
    assert.notEqual(login.status, 200, "a deactivated account still signs in");
  });

  test("deleting closes the account for good", async () => {
    const created = await create(newPerson());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const removed = await api.del(`/api/hr/operations-managers/${created.body.item._id}`, H());
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const gone = await api.get(
      `/api/hr/operations-managers/${created.body.item._id}`,
      H()
    );
    assert.equal(gone.status, 404);
  });

  test("HR's other two manager screens still open their own kind of account", async () => {
    // The department head, who is a different role in the same panel
    const head = await api.post(
      "/api/hr/department-managers",
      newPerson({ designation: "Manager" }),
      H()
    );
    assert.equal(head.status, 201, JSON.stringify(head.body));
    assert.equal(head.body.item.role, "manager");

    // And the Sales login, which lives on a panel of its own
    const person = newPerson({ designation: "Sales Manager", role: "sales" });
    const sales = await api.post("/api/hr/sales-managers", person, H());
    assert.equal(sales.status, 201, JSON.stringify(sales.body));
    assert.equal(sales.body.item.role, "sales");
  });
});

/**
 * Hiring an employee straight from the HR panel.
 *
 * This route did not exist: an account was a hiring decision and went through
 * Candidates and Onboarding, which is right for a vacancy and wrong for the
 * person who starts on Monday with a signed offer — HR had to ask an
 * administrator to type the name in.
 *
 * The tests that matter here are the ones about what creating must NOT become:
 * a way to hand out a role, and a way around the rule that HR maintaining a
 * record cannot change what somebody signs in as.
 */
describe("HR hires an employee directly", () => {
  const newHire = (overrides = {}) => {
    counter += 1;
    return {
      name: `New Hire ${counter}`,
      email: `new-hire-${counter}@example.com`,
      phone: `90000000${String(10 + counter).slice(-2)}`,
      designation: "Site Engineer",
      department: "Execution",
      ...overrides,
    };
  };

  test("the account is created and signs in at the employee panel", async () => {
    const person = newHire();
    const res = await api.post("/api/hr/employees", person, H());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.role, "employee");

    const login = await api.post("/api/employee/login", {
      email: person.email,
      password: person.phone,
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
  });

  test("the role is forced, so hiring cannot mint an administrator", async () => {
    const res = await api.post("/api/hr/employees", newHire({ role: "admin" }), H());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.item.role, "employee");
  });

  test("the onboarding pack is stored with the hire", async () => {
    const person = newHire({
      documents: { aadhaarNumber: "1234 5678 9012", panNumber: "abcde1234f" },
      bank: {
        accountName: "The New Hire",
        accountNumber: "123456789012",
        ifsc: "hdfc0001234",
        bankName: "HDFC Bank",
      },
    });

    const created = await api.post("/api/hr/employees", person, H());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    /**
     * The list leaves the heavy sub-documents out on purpose, so the record is
     * read back one person at a time — which is also the only way to see that
     * the numbers were normalised on the way in rather than stored as typed.
     */
    const one = await api.get(`/api/hr/employees/${created.body.item._id}`, H());
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.item.documents.aadhaarNumber, "123456789012");
    assert.equal(one.body.item.documents.panNumber, "ABCDE1234F");
    assert.equal(one.body.item.bank.ifsc, "HDFC0001234");
    assert.equal(one.body.item.bank.accountName, "The New Hire");
  });

  test("the list answers with the tiles above it", async () => {
    const before = await api.get("/api/hr/employees", H());
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.ok(before.body.summary, "the employees list sends no summary for the tiles");

    const created = await api.post("/api/hr/employees", newHire(), H());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const after = await api.get("/api/hr/employees", H());
    assert.equal(after.body.summary.total, before.body.summary.total + 1);
    assert.equal(after.body.summary.active, before.body.summary.active + 1);

    /**
     * The status filter is lifted before counting, so the tiles do not change
     * the moment one of them is clicked.
     */
    const filtered = await api.get("/api/hr/employees?status=inactive", H());
    assert.equal(filtered.body.summary.total, after.body.summary.total);
  });

  test("a second account cannot take an email already in use", async () => {
    const person = newHire();

    const first = await api.post("/api/hr/employees", person, H());
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const again = await api.post("/api/hr/employees", person, H());
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  test("the new hire is in HR's directory and the admin panel's list", async () => {
    const person = newHire();
    const created = await api.post("/api/hr/employees", person, H());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const hr = await api.get("/api/hr/employees?search=" + person.email, H());
    assert.ok(
      (hr.body.items || []).some((row) => row.email === person.email),
      "the person HR just hired is missing from HR's own directory"
    );

    const admin = await api.get("/api/admin/employees?search=" + person.email, A());
    assert.ok(
      (admin.body.items || []).some((row) => row.email === person.email),
      "one panel hired somebody the other cannot see"
    );
  });

  test("editing still cannot change what somebody signs in as", async () => {
    const person = newHire();
    const created = await api.post("/api/hr/employees", person, H());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const edited = await api.put(
      `/api/hr/employees/${created.body.item._id}`,
      { designation: "Senior Engineer", role: "admin", password: "hijacked-1" },
      H()
    );
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.item.designation, "Senior Engineer");
    assert.equal(edited.body.item.role, "employee", "an edit changed somebody's role");

    // The password the account was created with still works, so the one in
    // the edit body was ignored rather than applied
    const login = await api.post("/api/employee/login", {
      email: person.email,
      password: person.phone,
    });
    assert.equal(login.status, 200, "an edit reset somebody's password");
  });

  test("deleting a person is still not offered to HR", async () => {
    const created = await api.post("/api/hr/employees", newHire(), H());
    assert.equal(created.status, 201, JSON.stringify(created.body));

    /**
     * Refused by the module guard rather than by a missing route: HR holds
     * view, create and edit on employees and not delete, so the request is
     * turned away before any handler is looked for. Both halves of that —
     * the permission and the absent route — have to stay as they are.
     */
    const removed = await api.del(`/api/hr/employees/${created.body.item._id}`, H());
    assert.equal(removed.status, 403, "HR was given a way to delete somebody");
  });
});
