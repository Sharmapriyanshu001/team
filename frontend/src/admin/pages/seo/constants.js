/** Option lists shared by the SEO screens. Each mirrors an enum in a model. */

export const SEO_SERVICES = [
  { value: "seo", label: "SEO" },
  { value: "smo", label: "Social" },
  { value: "both", label: "SEO + Social" },
];

export const SEO_STATUS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];

export const BACKLINK_TYPES = [
  { value: "guest_post", label: "Guest post" },
  { value: "directory", label: "Directory" },
  { value: "profile", label: "Profile" },
  { value: "forum", label: "Forum" },
  { value: "press", label: "Press" },
  { value: "editorial", label: "Editorial" },
  { value: "other", label: "Other" },
];

export const BACKLINK_STATUS = [
  { value: "pending", label: "Pending" },
  { value: "live", label: "Live" },
  { value: "lost", label: "Lost" },
  { value: "rejected", label: "Rejected" },
  { value: "nofollow", label: "Nofollow" },
];

export const SOCIAL_PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "youtube", label: "YouTube" },
  { value: "pinterest", label: "Pinterest" },
  { value: "threads", label: "Threads" },
  { value: "other", label: "Other" },
];

export const POST_STATUS = [
  { value: "idea", label: "Idea" },
  { value: "drafted", label: "Drafted" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "cancelled", label: "Cancelled" },
];

export const ISSUE_SEVERITY = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "notice", label: "Notice" },
];

export const PRIORITY = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
