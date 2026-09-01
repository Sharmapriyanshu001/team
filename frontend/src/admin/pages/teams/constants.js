/** Option lists and the one shared piece of UI the team screens both use. */

export const TEAM_KINDS = [
  { value: "hr", label: "HR" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "accounts", label: "Accounts" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const monthOptions = () =>
  MONTH_NAMES.map((label, index) => ({ value: index + 1, label }));

export const yearOptions = () => {
  const now = new Date().getFullYear();
  return [now - 1, now, now + 1].map((year) => ({ value: year, label: String(year) }));
};

const inr = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

/** A target's figure, written the way the metric is actually measured. */
export const formatValue = (value, unit) => {
  if (value === null || value === undefined) return "—";
  if (unit === "currency") return inr(value);
  if (unit === "percent") return `${Math.round(value)}%`;
  return Number(value).toLocaleString("en-IN");
};
