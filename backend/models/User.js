import mongoose from "mongoose";

/**
 * "super_admin" sits above "admin" rather than replacing it: every existing
 * account keeps the role it already has, and everywhere the app asks "is this
 * an admin" a super admin answers yes too. Nothing that worked before this
 * role existed behaves differently because of it.
 */
/**
 * "manager" sits between admin and operations_manager: a department head who answers
 * for a team's numbers but is not an administrator of the panel. They sign in
 * through the operations manager's panel and see their whole department rather than
 * one project — see middleware/leaderAuth.js.
 *
 * Added at the end of the meaningful order rather than the array, because
 * nothing reads the position; every existing account keeps the role it has.
 */
/**
 * "hr", "sales" and "operations" are department accounts: staff who run one
 * side of the business and sign in to the admin panel to do it, seeing only
 * their own department.
 *
 * They are appended rather than inserted, because two of them already exist in
 * the database — created by an earlier build and unable to sign in anywhere
 * since, the role not being in this list. Adding them here is what makes those
 * records mean something again.
 *
 * There is deliberately no ceiling on how many of each there may be. Three HR
 * accounts is an ordinary thing for a company to want, and a system that
 * allows exactly one is a system somebody works around by sharing a password.
 */
export const USER_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "operations_manager",
  "employee",
  "user",
  "hr",
  "hr_manager",
  "sales",
  "sales_exec",
  "operations",
];

/** The two roles that use the operations manager's panel. */
export const LEADER_ROLES = ["manager", "operations_manager"];

/* --------------------------------------------------- how somebody works */

/** Where the job is done. A field sales manager is not office staff. */
export const WORK_LOCATIONS = ["office", "field", "hybrid", "remote"];

/** On what terms. Drives nothing yet; recorded because payroll asks. */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant"];

/**
 * What somebody actually does, as a list rather than one job title.
 *
 * A sales manager who runs field visits, handles the Google Ads account and
 * chases follow-ups has three answers to "what do you do", and a single
 * designation string can hold none of them. Kept as a suggested list rather
 * than an enum: a company invents a responsibility the week after you ship,
 * and a validation error is a poor answer to that.
 */
export const WORK_RESPONSIBILITIES = [
  "Field Sales",
  "Office Sales",
  "Lead Generation",
  "Client Handling",
  "Google Ads",
  "SEO",
  "SEO Advertisement",
  "Social Media Marketing",
  "Digital Marketing",
  "Calling",
  "Follow-ups",
  "Sales Target & Team Management",
];

/**
 * Full administrators. Unchanged — every place that asked this before gets the
 * same two roles back, so nothing that relied on it has moved.
 */
export const ADMIN_ROLES = ["super_admin", "admin"];

/**
 * Department heads. They pass the admin panel's door but are never
 * unrestricted: what each may touch comes from their department's role, and
 * permissionsFor() refuses to fall back to "everything" for them the way it
 * does for a plain admin with no role assigned.
 */
export const DEPARTMENT_ROLES = ["hr", "hr_manager", "sales", "sales_exec", "operations"];

/**
 * The two roles that use the HR panel.
 *
 * "hr" is the HR head: they run the panel and are the only account that may
 * create, edit, deactivate or delete other HR logins. "hr_manager" is an
 * ordinary member of the HR team — every HR screen except that one.
 *
 * Neither is capped. A company with three HR people needs three HR logins;
 * one shared account is an audit trail that says "HR" and never says who. The
 * database was found enforcing a ceiling of exactly one through a unique
 * index — see utils/dbGuards.js, which removes it and keeps it removed.
 */
export const HR_PANEL_ROLES = ["hr", "hr_manager"];

/** The HR head. The only HR role that may manage other HR accounts. */
export const HR_ADMIN_ROLE = "hr";

/**
 * The two roles that use the Sales panel.
 *
 * "sales" is the Sales head: they see the whole pipeline, assign leads, and
 * are the only account that may create, edit, deactivate or delete other sales
 * logins. "sales_exec" is an executive on the floor — the same screens, but
 * scoped to the leads assigned to them.
 *
 * That scoping is the difference that matters and it is enforced in the
 * queries, not the menus: see utils/salesAccess.js and the sales controllers,
 * every one of which filters by owner for an executive. Hiding a row has never
 * been access control.
 *
 * Neither is capped, for the same reason no HR role is.
 */
export const SALES_PANEL_ROLES = ["sales", "sales_exec"];

/** The Sales head. The only sales role that may manage other sales accounts. */
export const SALES_ADMIN_ROLE = "sales";


/** Department accounts that sign in through the admin panel. */
/**
 * Department accounts that still sign in through the admin panel.
 *
 * Sales left when it got a panel of its own, for exactly the reason HR did: a
 * separate door is a stronger guarantee than a filtered menu. Operations is
 * the only department still here.
 */
export const ADMIN_DEPARTMENT_ROLES = ["operations"];

/**
 * Everybody the admin panel will let in at all.
 *
 * HR is deliberately absent. HR has a panel of its own at /hr with its own
 * token and its own routes, so an HR account cannot authenticate against
 * /api/admin at all — which is a stronger guarantee that HR reaches no
 * administrator, Sales or Operations data than any arrangement of permissions
 * inside one shared panel could give. Sales left for the same reason and has
 * its own panel at /sales. Operations still signs in here.
 */
export const ADMIN_PANEL_ROLES = [...ADMIN_ROLES, ...ADMIN_DEPARTMENT_ROLES];

/** What each department is called, for labels and for its default role. */
export const DEPARTMENT_LABELS = {
  hr: "Human Resources",
  hr_manager: "HR Manager",
  sales: "Sales",
  sales_exec: "Sales Executive",
  operations: "Operations",
};

/**
 * One uploaded paper. The bytes live under uploads/ and are never served
 * statically — `storedName` is only meaningful to a route that has already
 * decided the caller may see it.
 */
const uploadedFileSchema = new mongoose.Schema(
  {
    storedName: { type: String, trim: true, required: true },
    originalName: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * Proof of identity: the two cards everybody is asked for, each photographed
 * on both sides.
 *
 * Numbers are stored as typed rather than normalised away, because what is
 * useful later is being able to read back the same string that is printed on
 * the card. They are checked for shape on the way in instead.
 */
const identityDocumentsSchema = new mongoose.Schema(
  {
    aadhaarNumber: { type: String, trim: true, default: "" },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    aadhaarFront: { type: uploadedFileSchema, default: undefined },
    aadhaarBack: { type: uploadedFileSchema, default: undefined },
    panFront: { type: uploadedFileSchema, default: undefined },
    panBack: { type: uploadedFileSchema, default: undefined },

    /**
     * Their CV.
     *
     * Filed with the identity papers rather than under previous employment,
     * because a fresher has a CV and no previous employer — and because it is
     * the one document somebody goes looking for months later, which makes it
     * an identity paper in practice whatever it is in theory.
     */
    resume: { type: uploadedFileSchema, default: undefined },
  },
  { _id: false }
);

/** Where salary goes. */
const bankDetailsSchema = new mongoose.Schema(
  {
    accountName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    ifsc: { type: String, trim: true, uppercase: true, default: "" },
    bankName: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: "" },
    upi: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

/**
 * Where they worked before. Entirely optional — a fresher has none of it, and
 * an experienced hire often turns up with the letters weeks later.
 */
const previousEmploymentSchema = new mongoose.Schema(
  {
    companyName: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    lastSalary: { type: String, trim: true, default: "" },
    from: { type: Date },
    to: { type: Date },
    experienceLetter: { type: uploadedFileSchema, default: undefined },
    salarySlip: { type: uploadedFileSchema, default: undefined },
    relievingLetter: { type: uploadedFileSchema, default: undefined },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: "user",
    },
    phone: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    department: { type: String, trim: true, default: "" },
    joiningDate: { type: Date },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    // Employees report to an operations manager
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /* ------------------------------------------------- who they are, at work */

    /**
     * The company's own code for this person — EMP-014, SM-03, whatever the
     * office already writes on things.
     *
     * Not the login and not the database id. People refer to each other by it
     * on a salary slip and in a WhatsApp message, and without somewhere to put
     * it that reference has no home in the system. Optional, and unique only as
     * far as the handler that writes it checks — no index, because an index on
     * a field most existing rows leave empty is a migration nobody asked for.
     */
    employeeId: { type: String, trim: true, uppercase: true, default: "" },

    /** Where the work happens, and on what terms. */
    workLocation: { type: String, enum: [...WORK_LOCATIONS, ""], default: "" },
    employmentType: { type: String, enum: [...EMPLOYMENT_TYPES, ""], default: "" },

    /**
     * The job inside the department — "Field Sales Manager", "Inside Sales".
     *
     * Deliberately separate from `role`, which decides which panel they can
     * open. Two people can both be `sales` and one of them runs the field team
     * while the other sits on the phone, and the login role cannot say that.
     */
    salesRole: { type: String, trim: true, default: "" },

    /** How many people answer to them. Zero for somebody who runs nobody. */
    teamSize: { type: Number, min: 0, default: 0 },

    /**
     * What they do and what they are good at.
     *
     * Two lists rather than one: a responsibility is something the company has
     * given them, a skill is something they brought. HR fills the first when
     * the role is defined and the second from the CV, and merging them loses
     * which is which.
     */
    responsibilities: { type: [String], default: [] },
    skills: { type: [String], default: [] },

    /**
     * Where they live. One block of text rather than line/city/state/pincode,
     * because that is how an address is actually written down here and a form
     * with four boxes gets three of them left empty.
     */
    address: { type: String, trim: true, default: "" },

    /**
     * What a day of their work is worth.
     *
     * A daily rate rather than a monthly salary, because that is what this
     * company actually pays on: the attendance sheet is marked day by day, and
     * what somebody has earned by the 14th is a question with an exact answer
     * — days worked × rate. A monthly figure would have to be divided by
     * something, and every month has a different number of working days.
     *
     * Nested under `pay` rather than sitting loose as `dailyRate` so the next
     * thing payroll needs — a PF deduction, a shift allowance — has somewhere
     * obvious to go without another migration.
     *
     * Zero means nobody has set it, and the salary screen says so rather than
     * reporting that they have earned nothing.
     */
    pay: {
      dailyRate: { type: Number, default: 0, min: 0 },
    },

    /**
     * Which Role's permissions apply to this admin. Left empty means
     * unrestricted — that is exactly how every admin behaved before
     * permissions were enforced, so existing accounts lose nothing.
     *
     * Ignored for super admins, who are never restricted, and for team
     * leaders and employees, whose access is decided per project.
     */
    permissionRole: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },

    /**
     * Bumped whenever every existing session for this account should stop
     * working: a sign-out, a password change, an admin resetting the password.
     *
     * A JWT cannot be recalled — once signed it is valid until it expires, and
     * these last seven days. So the token carries the number it was minted
     * with and the auth middleware compares it against this one; a token from
     * before the bump no longer matches and is refused.
     *
     * Tokens issued before this field existed carry no number at all, and are
     * read as 0 so that adding this did not sign everybody out mid-week.
     */
    tokenVersion: { type: Number, default: 0 },

    /* ------------------------------------------------------- the onboarding file */

    /**
     * What is collected when somebody joins, beyond the details needed to give
     * them a login.
     *
     * Three separate sub-documents rather than thirty fields on the user,
     * because they are asked for at three different moments and are read back
     * by three different people — and because keeping them apart is what lets
     * the staff list leave them out of its response entirely. Nobody browsing
     * a table of employees needs everyone's Aadhaar number in their browser.
     *
     * All optional at the schema level. Whether a particular one has to be
     * filled in is a question about the form somebody is standing in front of,
     * not about what a User is, so it is answered there — and answering it
     * here would make every account that predates this unsaveable.
     */
    documents: { type: identityDocumentsSchema, default: () => ({}) },
    bank: { type: bankDetailsSchema, default: () => ({}) },
    previousEmployment: { type: previousEmploymentSchema, default: () => ({}) },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
