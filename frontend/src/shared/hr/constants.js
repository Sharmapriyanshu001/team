/**
 * The HR vocabulary, in one place.
 *
 * Every list here mirrors an enum the server validates against — models/Leave
 * and models/Candidate. Kept in step by hand rather than fetched, because a
 * dropdown that cannot render until a second request lands is a dropdown that
 * flickers; the cost is remembering to add to both, which is what these
 * comments are for.
 */

export const LEAVE_TYPES = [
  { value: "casual", label: "Casual" },
  { value: "sick", label: "Sick" },
  { value: "earned", label: "Earned" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "half_day", label: "Half day" },
  { value: "work_from_home", label: "Work from home" },
  { value: "maternity", label: "Maternity" },
  { value: "paternity", label: "Paternity" },
  { value: "bereavement", label: "Bereavement" },
  { value: "other", label: "Other" },
];

export const LEAVE_STATUS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * The hiring pipeline, in order. Mirrors CANDIDATE_STAGES on the server.
 *
 * "offer" is deliberately absent: rows in the database may still carry it and
 * the server still accepts it, but it means the same thing as "selected" and
 * offering both on a form would invite somebody to pick the wrong one. It is
 * displayed as Selected wherever it turns up — see stageLabel.
 */
export const CANDIDATE_STAGES = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "selected", label: "Selected" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

/** The stages a candidate is still in play in — the pipeline board's columns. */
export const OPEN_STAGES = ["applied", "screening", "interview", "shortlisted", "selected"];

/** "We have agreed to take this person", however the row spells it. */
export const SELECTED_STAGES = ["selected", "offer"];

/** What each stage moves to next, for the "advance" action on a card. */
export const NEXT_STAGE = {
  applied: "screening",
  screening: "interview",
  interview: "shortlisted",
  shortlisted: "selected",
};

export const OPENING_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "on_hold", label: "On hold" },
  { value: "closed", label: "Closed" },
  { value: "filled", label: "Filled" },
];

export const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "temporary", label: "Temporary" },
];

export const CANDIDATE_SOURCES = [
  { value: "referral", label: "Referral" },
  { value: "agency", label: "Agency" },
  { value: "job_portal", label: "Job portal" },
  { value: "website", label: "Website" },
  { value: "social", label: "Social" },
  { value: "walk_in", label: "Walk-in" },
  { value: "campus", label: "Campus" },
  { value: "other", label: "Other" },
];

/** What a hire's account is created as. Mirrors HIRE_AS_ROLES on the server. */
export const HIRE_AS_ROLES = [
  { value: "employee", label: "Employee" },
  { value: "operations_manager", label: "Operations Manager" },
  { value: "manager", label: "Manager" },
  { value: "hr", label: "HR (department account)" },
  { value: "sales", label: "Sales (department account)" },
  { value: "operations", label: "Operations (department account)" },
];

export const INTERVIEW_OUTCOMES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "no_show", label: "No show" },
  { value: "cancelled", label: "Cancelled" },
];

const labelFrom = (list) => (value) =>
  list.find((entry) => entry.value === value)?.label || value || "—";

export const leaveTypeLabel = labelFrom(LEAVE_TYPES);
/** Legacy "offer" rows read as Selected rather than as a stage of their own. */
export const stageLabel = (value) =>
  value === "offer" ? "Selected" : labelFrom(CANDIDATE_STAGES)(value);

export const openingStatusLabel = labelFrom(OPENING_STATUS);
export const employmentTypeLabel = labelFrom(EMPLOYMENT_TYPES);

/** Short money, the way a salary band reads rather than a full invoice total. */
export const money = (value) =>
  value ? `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "";

export const salaryBand = (min, max) => {
  if (!min && !max) return "Not stated";
  if (min && max) return `${money(min)} – ${money(max)}`;
  return money(min || max);
};

/** Whole days between two dates, for "open 12 days". */
export const daysSince = (value) =>
  value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0;
export const sourceLabel = labelFrom(CANDIDATE_SOURCES);

/** Short date, the way every other screen in the panel prints one. */
export const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/** A span, printed as one date when both ends are the same day. */
export const dateRange = (from, to) => {
  const start = shortDate(from);
  const end = shortDate(to);
  return start === end ? start : `${start} → ${end}`;
};

export const monthOptions = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, index) => ({ value: index + 1, label }));

export const yearOptions = (() => {
  const now = new Date().getFullYear();
  return [now + 1, now, now - 1, now - 2].map((year) => ({ value: year, label: String(year) }));
})();
