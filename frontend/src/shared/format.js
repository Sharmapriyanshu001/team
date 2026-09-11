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

// "in_progress" -> "In Progress". Used for every enum value shown in the UI.
export const prettify = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// 1536000 -> "1.5 MB". Every stored scan carries its size in bytes.
// Anything under a kilobyte is shown in bytes rather than rounded to "0 KB",
// which reads as a broken file rather than a small one.
export const fileSize = (bytes = 0) => {
  if (!bytes) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};
