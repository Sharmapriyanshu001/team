import mongoose from "mongoose";

/**
 * "super_admin" sits above "admin" rather than replacing it: every existing
 * account keeps the role it already has, and everywhere the app asks "is this
 * an admin" a super admin answers yes too. Nothing that worked before this
 * role existed behaves differently because of it.
 */
export const USER_ROLES = ["super_admin", "admin", "team_leader", "employee", "user"];

export const ADMIN_ROLES = ["super_admin", "admin"];

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
    // Employees report to a team leader
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /**
     * Which Role's permissions apply to this admin. Left empty means
     * unrestricted — that is exactly how every admin behaved before
     * permissions were enforced, so existing accounts lose nothing.
     *
     * Ignored for super admins, who are never restricted, and for team
     * leaders and employees, whose access is decided per project.
     */
    permissionRole: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },

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
