/** Option lists shared by the CRM screens. Each mirrors an enum in a model. */

export const LEAD_STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "quoted", label: "Quoted" },
  { value: "negotiating", label: "Negotiating" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export const LEAD_SOURCES = [
  { value: "referral", label: "Referral" },
  { value: "website", label: "Website" },
  { value: "social", label: "Social" },
  { value: "cold_outreach", label: "Cold outreach" },
  { value: "marketplace", label: "Marketplace" },
  { value: "walk_in", label: "Walk-in" },
  { value: "repeat_client", label: "Repeat client" },
  { value: "other", label: "Other" },
];

export const QUOTATION_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

export const INVOICE_STATUS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partly_paid", label: "Partly paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

export const BILLING_UNITS = [
  { value: "fixed", label: "Fixed" },
  { value: "hour", label: "Per hour" },
  { value: "day", label: "Per day" },
  { value: "month", label: "Per month" },
  { value: "year", label: "Per year" },
  { value: "page", label: "Per page" },
  { value: "app", label: "Per app" },
];

export const CREDENTIAL_TYPES = [
  { value: "play_console", label: "Play Console" },
  { value: "hosting", label: "Hosting" },
  { value: "cpanel", label: "cPanel" },
  { value: "ftp", label: "FTP" },
  { value: "domain", label: "Domain registrar" },
  { value: "database", label: "Database" },
  { value: "wordpress", label: "WordPress" },
  { value: "social", label: "Social account" },
  { value: "email", label: "Email" },
  { value: "api_key", label: "API key" },
  { value: "other", label: "Other" },
];
