// Indian short money: 12000000 -> "₹1.2 Cr", 250000 -> "₹2.5 L".
export const money = (value = 0) => {
  const amount = Number(value) || 0;
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${amount.toLocaleString("en-IN")}`;
};

// "Arjun Kapoor" -> "AK". Used by every avatar in the panels.
export const initialsOf = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

// Bytes as something a person reads. "—" for nothing, because a file of no
// size is almost always a record with no upload behind it.
export const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

// "in_progress" -> "In Progress". Used for every enum value shown in the UI.
export const prettify = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
