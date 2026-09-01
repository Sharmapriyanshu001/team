/** Option lists and money formatting shared by the portfolio screens. */

export const PROPERTY_KINDS = [
  { value: "android_app", label: "Android app" },
  { value: "ios_app", label: "iOS app" },
  { value: "website", label: "Website" },
  { value: "game", label: "Game" },
  { value: "other", label: "Other" },
];

export const PROPERTY_STATUS = [
  { value: "building", label: "Building" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "retired", label: "Retired" },
];

export const REVENUE_SOURCES = [
  { value: "admob", label: "AdMob" },
  { value: "adsense", label: "AdSense" },
  { value: "in_app_purchase", label: "In-app purchase" },
  { value: "subscription", label: "Subscription" },
  { value: "affiliate", label: "Affiliate" },
  { value: "sponsorship", label: "Sponsorship" },
  { value: "direct_sale", label: "Direct sale" },
  { value: "other", label: "Other" },
];

export const EXPENSE_CATEGORIES = [
  { value: "ad_spend", label: "Ad spend" },
  { value: "hosting", label: "Hosting" },
  { value: "domain", label: "Domain" },
  { value: "tools", label: "Tools / SaaS" },
  { value: "freelancer", label: "Freelancer" },
  { value: "developer_account", label: "Developer account" },
  { value: "content", label: "Content" },
  { value: "assets", label: "Assets" },
  { value: "other", label: "Other" },
];

export const CURRENCIES = [
  { value: "INR", label: "INR ₹" },
  { value: "USD", label: "USD $" },
  { value: "EUR", label: "EUR €" },
  { value: "GBP", label: "GBP £" },
];

export const money = (value) =>
  value === null || value === undefined
    ? "—"
    : `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;

/** Same, but a loss reads as a loss rather than as a number with a minus sign. */
export const signedMoney = (value) => {
  const number = Number(value) || 0;
  return number < 0 ? `−₹${Math.round(Math.abs(number)).toLocaleString("en-IN")}` : money(number);
};

export const labelOf = (list, value) =>
  list.find((row) => row.value === value)?.label || String(value || "").replace(/_/g, " ");
