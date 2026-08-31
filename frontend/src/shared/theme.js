// Blue / white / black palette shared by every chart in the panel.
export const CHART = {
  blue: "#2563EB",
  blueDark: "#1D4ED8",
  blueMid: "#3B82F6",
  blueLight: "#60A5FA",
  bluePale: "#93C5FD",
  black: "#0F172A",
  slate: "#475569",
  grey: "#94A3B8",
  greyLight: "#CBD5E1",
  grid: "#E2E8F0",
};

// Ordered series colours — blues first, then black/grey so a chart with many
// slices still reads as one system.
export const SERIES = [
  CHART.blue,
  CHART.black,
  CHART.blueLight,
  CHART.slate,
  CHART.blueDark,
  CHART.greyLight,
];

// Status -> colour, used by both charts and badges.
export const STATUS_COLORS = {
  planning: CHART.bluePale,
  in_progress: CHART.blue,
  on_hold: CHART.grey,
  completed: CHART.black,
  cancelled: CHART.greyLight,

  pending: CHART.bluePale,
  review: CHART.blueLight,

  open: CHART.blue,
  resolved: CHART.black,
  closed: CHART.grey,

  present: CHART.blue,
  absent: CHART.black,
  half_day: CHART.blueLight,
  leave: CHART.grey,

  active: CHART.blue,
  inactive: CHART.grey,
  lead: CHART.blueLight,

  low: CHART.bluePale,
  medium: CHART.blue,
  high: CHART.blueDark,
  critical: CHART.black,
};

// Tooltip styling reused across every Recharts chart.
export const tooltipStyle = {
  contentStyle: {
    background: "#0F172A",
    border: "none",
    borderRadius: 10,
    color: "#fff",
    fontSize: 12,
    padding: "8px 12px",
  },
  labelStyle: { color: "#94A3B8", marginBottom: 4, fontSize: 11 },
  itemStyle: { color: "#fff" },
  cursor: { fill: "rgba(37, 99, 235, 0.06)" },
};
