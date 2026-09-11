import mongoose from "mongoose";

import { removeStoredFile } from "../utils/uploads.js";
import { uploadedFileSchema } from "./uploadedFile.js";

/**
 * Somebody being considered for a job.
 *
 * The recruitment half of HR, and the mirror of a Lead: a pipeline with
 * stages, an owner, a value attached, and an outcome that creates a real
 * record elsewhere when it goes well. Hiring one produces a User with a login,
 * the way winning a lead produces a Client with a portal — and the candidate
 * is kept and linked rather than deleted, because how long a hire took and
 * which source it came from is the only way to learn which sources work.
 *
 * Field names match rows already in this database from an earlier build. See
 * models/Leave.js for why that constraint exists.
 */

/**
 * The hiring pipeline, in order.
 *
 * "shortlisted" and "selected" were added when Hiring became a section of its
 * own: they are the two decisions a company actually makes about a candidate,
 * and collapsing them into "offer" meant the panel could not answer "who have
 * we agreed to take" separately from "who is worth interviewing again".
 *
 * "offer" is kept because rows in this database may already carry it, and
 * because dropping a value from an enum makes every document holding it
 * unsaveable. It is treated as equivalent to "selected" everywhere it is read
 * — see SELECTED_STAGES — and is not offered on any form.
 */
export const CANDIDATE_STAGES = [
  "applied",
  "screening",
  "interview",
  "shortlisted",
  "selected",
  "offer",
  "hired",
  "rejected",
];

/** Still in play — neither hired nor turned down. */
export const OPEN_STAGES = ["applied", "screening", "interview", "shortlisted", "selected"];

/** "We have agreed to take this person", however the row spells it. */
export const SELECTED_STAGES = ["selected", "offer"];

/** The order stages advance in, for the "move forward" action. */
export const STAGE_ORDER = [
  "applied",
  "screening",
  "interview",
  "shortlisted",
  "selected",
  "hired",
];

export const CANDIDATE_SOURCES = [
  "referral",
  "agency",
  "job_portal",
  "website",
  "social",
  "walk_in",
  "campus",
  "other",
];

/** What a hired candidate becomes. Their login is created with this role. */
export const HIRE_AS_ROLES = [
  "employee",
  "operations_manager",
  "manager",
  "hr",
  "hr_manager",
  "sales",
  "operations",
];

/** One round, and how it went. Embedded — a round has no life of its own. */
const interviewSchema = new mongoose.Schema(
  {
    round: { type: String, trim: true, default: "" },
    scheduledAt: { type: Date },
    mode: { type: String, trim: true, default: "" },
    interviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    interviewerName: { type: String, trim: true, default: "" },
    feedback: { type: String, trim: true, default: "" },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    outcome: {
      type: String,
      enum: ["scheduled", "passed", "failed", "no_show", "cancelled"],
      default: "scheduled",
    },
  },
  { _id: true }
);

const candidateSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },

    /**
     * Where they live. Recorded on the applicant rather than only on the staff
     * record it becomes, so somebody asked for it at the interview does not
     * have to be asked again on their first morning — the hire reads it
     * straight across.
     */
    address: { type: String, trim: true, default: "" },

    position: { type: String, trim: true, default: "" },
    department: { type: String, trim: true, default: "" },
    experience: { type: String, trim: true, default: "" },
    skills: { type: [String], default: [] },

    /**
     * A link to a CV somewhere else. Kept because rows in this database carry
     * it, and still filled in by anyone who has only a URL — but `resume`
     * below is what the panel asks for now, for the reason the hire route has
     * always given: a link into somebody else's Drive stops working the week
     * they tidy it up.
     */
    resumeUrl: { type: String, trim: true, default: "" },

    /**
     * Their CV, as bytes this company holds.
     *
     * Asked for when the application is recorded rather than at the hire. The
     * hire is the one candidate in twenty who got that far; the other nineteen
     * are shortlisted or turned down by reading this, and until it lived here
     * there was nowhere to put it.
     */
    resume: { type: uploadedFileSchema, default: undefined },

    /**
     * How long before they could start — "immediate", "30 days", "2 months".
     *
     * Free text rather than a number of days, because that is how it is said
     * in the conversation it comes up in, and rounding "serving notice, last
     * day the 14th" into a number loses the only part that was useful.
     */
    noticePeriod: { type: String, trim: true, default: "" },

    /** What they are on now. Expected means little without it. */
    currentSalary: { type: Number, default: 0, min: 0 },

    source: { type: String, enum: CANDIDATE_SOURCES, default: "other" },
    sourceDetail: { type: String, trim: true, default: "" },

    stage: { type: String, enum: CANDIDATE_STAGES, default: "applied" },

    expectedSalary: { type: Number, default: 0, min: 0 },
    offeredSalary: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, default: "" },
    rejectionReason: { type: String, trim: true, default: "" },

    /** What role their account gets if they are hired. */
    hireAs: { type: String, enum: HIRE_AS_ROLES, default: "employee" },

    interviews: { type: [interviewSchema], default: [] },

    /**
     * The vacancy this person applied for.
     *
     * Optional, because a CV that arrives unsolicited is a real thing and
     * refusing to record it until somebody invents an opening for it would
     * lose the candidate. But a pipeline with no opening behind it cannot be
     * measured — three candidates is good news for one seat and bad for five —
     * so the board nudges toward attaching one.
     */
    jobOpening: { type: mongoose.Schema.Types.ObjectId, ref: "JobOpening" },

    /* -------------------------------------------------------- the outcome */

    /** Each decision stamps its own date, so time-to-hire can be measured. */
    shortlistedAt: { type: Date },
    selectedAt: { type: Date },
    hiredAt: { type: Date },
    rejectedAt: { type: Date },

    /** Set when hiring this candidate created their staff account. */
    hiredUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /**
     * Everything between "we have selected them" and "they work here".
     *
     * A separate sub-document rather than fields on the candidate, because it
     * only exists for the handful of people who get that far and because it is
     * filled in by a different person at a different time — the checklist is
     * chased over days, and the account is created once at the end of it.
     *
     * `completedAt` is set by the hire route, not by ticking the last box: a
     * candidate is onboarded when they have a login, and any other definition
     * lets somebody be marked complete with no account to show for it.
     */
    onboarding: {
      startedAt: { type: Date },
      joiningDate: { type: Date },
      designation: { type: String, trim: true, default: "" },
      department: { type: String, trim: true, default: "" },
      reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      notes: { type: String, trim: true, default: "" },
      /**
       * What still has to happen. Stored per candidate rather than as a
       * template, so changing the company's checklist next year does not
       * rewrite the history of everybody onboarded under the old one.
       */
      checklist: {
        type: [
          {
            label: { type: String, trim: true, required: true },
            done: { type: Boolean, default: false },
            doneAt: { type: Date },
            doneByName: { type: String, trim: true, default: "" },
          },
        ],
        default: [],
      },
      completedAt: { type: Date },
    },

    /** Whoever on HR is carrying this one. */
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * Deleting the application takes its CV off the disk with it.
 *
 * The shared CRUD remove only deletes the document, so without this every
 * candidate ever turned down leaves a PDF behind that nothing references and
 * nobody will ever look for. A hired candidate's staff record holds its own
 * copy — see the hire route — so this never pulls a file out from under one.
 */
candidateSchema.pre("deleteOne", { document: true, query: false }, function () {
  if (this.resume?.storedName) removeStoredFile(this.resume.storedName);
});

candidateSchema.pre("save", function () {
  if (!this.isModified("stage")) return;

  const now = new Date();

  if (this.stage === "shortlisted" && !this.shortlistedAt) this.shortlistedAt = now;
  if (SELECTED_STAGES.includes(this.stage) && !this.selectedAt) this.selectedAt = now;
  if (this.stage === "hired" && !this.hiredAt) this.hiredAt = now;
  if (this.stage === "rejected" && !this.rejectedAt) this.rejectedAt = now;

  /**
   * Moving back out of an outcome clears its date, so a reopened candidate is
   * not counted as both hired and in play by every report that reads it.
   *
   * `shortlistedAt` and `selectedAt` are deliberately NOT cleared on the way
   * forward — a hired person was shortlisted, and the date they were is what
   * time-to-hire is measured from. They are only cleared on the way back.
   */
  if (!["hired", "rejected"].includes(this.stage)) {
    this.hiredAt = undefined;
    this.rejectedAt = undefined;
  }
  if (!SELECTED_STAGES.includes(this.stage) && this.stage !== "hired") {
    this.selectedAt = undefined;
  }
  if (["applied", "screening", "interview"].includes(this.stage)) {
    this.shortlistedAt = undefined;
  }
});

candidateSchema.index({ stage: 1, createdAt: -1 });
candidateSchema.index({ owner: 1, stage: 1 });
// The hiring board groups by opening; the onboarding list reads by stage
candidateSchema.index({ jobOpening: 1, stage: 1 });

const Candidate = mongoose.model("Candidate", candidateSchema);

export default Candidate;
