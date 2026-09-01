/** Option lists shared by the ads screens. Each mirrors an enum in a model. */

export const AD_PLATFORMS = [
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google Ads" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "other", label: "Other" },
];

export const AD_ACCOUNT_STATUS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "disabled", label: "Disabled" },
  { value: "closed", label: "Closed" },
];

/**
 * Whose money is on the account. The labels are written as somebody would say
 * them out loud, because this is the field people get wrong when it is phrased
 * as jargon.
 */
export const FUNDING_MODES = [
  { value: "client_card", label: "Client's own card" },
  { value: "studio_card", label: "We pay, then bill it back" },
  { value: "prepaid", label: "Client pays in advance" },
];

export const FEE_TYPES = [
  { value: "percent_of_spend", label: "% of spend" },
  { value: "flat_monthly", label: "Flat monthly" },
  { value: "none", label: "No fee" },
];

export const CAMPAIGN_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
  { value: "rejected", label: "Rejected" },
];

export const CAMPAIGN_OBJECTIVES = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
  { value: "leads", label: "Leads" },
  { value: "app_installs", label: "App installs" },
  { value: "sales", label: "Sales" },
  { value: "calls", label: "Calls" },
  { value: "other", label: "Other" },
];

export const rupees = (value) =>
  value === null || value === undefined
    ? "—"
    : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;

export const count = (value) =>
  value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN");
