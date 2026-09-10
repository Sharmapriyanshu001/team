/**
 * The vocabulary the Sales panel shares with the server.
 *
 * Kept here rather than imported per page so the two lists cannot drift apart
 * between screens — a stage the pipeline board knows about and the lead filter
 * does not is the kind of mismatch nobody notices until a deal disappears from
 * one view. The server is still the authority; this is only for labels and
 * ordering.
 */

export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "negotiating",
  "won",
  "lost",
];

/** The stages a deal is still live in — the board's columns. */
export const OPEN_STAGES = LEAD_STAGES.filter((s) => !["won", "lost"].includes(s));

export const LEAD_SOURCES = [
  "referral",
  "website",
  "social",
  "cold_outreach",
  "marketplace",
  "walk_in",
  "repeat_client",
  "other",
];

/**
 * Colour by meaning rather than by position: early stages read neutral, the
 * ones where money is on the table read warm, and the two outcomes read the
 * way outcomes should.
 */
export const STAGE_TONE = {
  new: "slate",
  contacted: "blue",
  qualified: "blue",
  quoted: "amber",
  negotiating: "amber",
  won: "green",
  lost: "red",
};

export const money = (n = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

export const prettify = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
