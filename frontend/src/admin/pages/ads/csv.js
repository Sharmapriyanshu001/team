/**
 * Reading a platform export.
 *
 * Meta and Google both hand out CSVs, and neither agrees with the other about
 * what a column is called — "Amount spent (INR)" against "Cost", "Impr."
 * against "Impressions", "Results" against "Conversions". So the file is
 * parsed generically and the columns are guessed from a list of names each
 * platform actually uses, with the guess shown to the person before anything
 * is imported. A wrong guess they can see and change is a different thing from
 * a wrong guess that silently writes a month of zeroes.
 */

/**
 * A CSV parser that copes with the two things exports actually do: quoted
 * fields containing commas, and doubled quotes inside them. Deliberately not a
 * library — this is forty lines, and a dependency for it would be a dependency
 * to keep patched forever.
 */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const clean = String(text)
    // A byte-order mark, which Excel puts at the front of every CSV it saves
    .replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Trailing blank lines, and Meta's habit of a summary row of empty cells
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
};

/**
 * Column names seen in the wild, per field. Matched case-insensitively and
 * ignoring anything in brackets, so "Amount spent (INR)" and "Amount spent
 * (USD)" are the same column.
 */
const ALIASES = {
  campaign: ["campaign name", "campaign", "campaign_name", "ad set name"],
  date: ["day", "date", "reporting starts", "week", "month", "date range"],
  spend: ["amount spent", "spend", "cost", "amount", "total spend"],
  impressions: ["impressions", "impr", "impr.", "reach"],
  clicks: ["link clicks", "clicks", "clicks all", "clicks (all)", "interactions"],
  conversions: ["results", "conversions", "conv", "conv.", "purchases", "leads", "all conv"],
  conversionValue: [
    "conversion value",
    "conv value",
    "conv. value",
    "purchase conversion value",
    "total conversion value",
    "revenue",
    "all conv. value",
  ],
};

const normalise = (header) =>
  String(header || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Best guess at which column is which. Returns { field: columnIndex }. */
export const guessColumns = (headers) => {
  const cleaned = headers.map(normalise);
  const mapping = {};

  Object.entries(ALIASES).forEach(([field, names]) => {
    // Exact match first, then a contains match, so "clicks" does not win over
    // "link clicks" simply by appearing earlier in the file
    let index = cleaned.findIndex((header) => names.includes(header));
    if (index < 0) {
      index = cleaned.findIndex((header) => names.some((name) => header.includes(name)));
    }
    if (index >= 0) mapping[field] = index;
  });

  return mapping;
};

/**
 * Numbers off a platform export.
 *
 * They arrive as "1,234.56", "₹1,234", "1 234", or "--" for nothing. The last
 * is the one that matters: a dash is "no data", and reading it as zero would
 * turn a day nobody has figures for into a day that spent nothing.
 */
export const readNumber = (value) => {
  const text = String(value ?? "").trim();
  if (!text || /^[-–—]+$/.test(text)) return null;

  const digits = text.replace(/[^\d.-]/g, "");
  if (!digits || digits === "-" || digits === ".") return null;

  const number = Number(digits);
  return Number.isFinite(number) ? number : null;
};

/**
 * Dates off a platform export.
 *
 * Both platforms write YYYY-MM-DD by default, which is unambiguous. Anything
 * else is handed to the Date constructor and then written back as a plain
 * calendar date, because a date-only string is what the server reads as the
 * day it names rather than as a moment in UTC.
 */
export const readDate = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // "01/09/2026" is read the Indian way — day first — because that is what a
  // person exporting from an Indian account is looking at.
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
    parsed.getDate()
  ).padStart(2, "0")}`;
};

/** Turn parsed rows plus a column mapping into what the import endpoint wants. */
export const buildRows = (dataRows, mapping) =>
  dataRows.map((cells) => {
    const at = (field) => (mapping[field] === undefined ? undefined : cells[mapping[field]]);

    return {
      campaign: String(at("campaign") ?? "").trim(),
      date: readDate(at("date")),
      spend: readNumber(at("spend")) ?? 0,
      impressions: readNumber(at("impressions")) ?? 0,
      clicks: readNumber(at("clicks")) ?? 0,
      conversions: readNumber(at("conversions")) ?? 0,
      conversionValue: readNumber(at("conversionValue")) ?? 0,
    };
  });

export const FIELD_LABELS = [
  ["campaign", "Campaign name", true],
  ["date", "Date", true],
  ["spend", "Spend", true],
  ["impressions", "Impressions", false],
  ["clicks", "Clicks", false],
  ["conversions", "Results / conversions", false],
  ["conversionValue", "Conversion value", false],
];
