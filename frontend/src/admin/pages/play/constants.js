/**
 * The option lists the Play screens share.
 *
 * In a file of their own because a page that also exports a constant loses
 * fast refresh — and because three screens showing the same status with three
 * different labels is exactly how "In review" and "Under review" end up in the
 * same table.
 *
 * Every list here mirrors an enum in the matching model. Changing one without
 * the other produces a dropdown whose values the server rejects.
 */

export const APP_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "live", label: "Live" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
  { value: "unpublished", label: "Unpublished" },
];

export const RELEASE_TRACKS = [
  { value: "internal", label: "Internal testing" },
  { value: "closed", label: "Closed testing" },
  { value: "open", label: "Open testing" },
  { value: "production", label: "Production" },
];

export const RELEASE_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "live", label: "Live" },
  { value: "rejected", label: "Rejected" },
  { value: "halted", label: "Halted" },
];

export const ALERT_TYPES = [
  { value: "warning", label: "Warning" },
  { value: "strike", label: "Strike" },
  { value: "rejection", label: "Rejection" },
  { value: "suspension", label: "Suspension" },
  { value: "data_safety", label: "Data safety" },
  { value: "policy_update", label: "Policy update" },
];

export const ALERT_SEVERITY = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const ALERT_STATUS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "Being handled" },
  { value: "resolved", label: "Resolved" },
  { value: "escalated", label: "Escalated" },
];

/** Google's caps on the store listing, shown as counters while typing. */
export const LISTING_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
};
