import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { prettify } from "../format";

/* ------------------------------------------------------------------ card */

export function Card({ className = "", children }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------- page header */

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- button */

const BUTTON_VARIANTS = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
  dark: "bg-slate-900 text-white hover:bg-black disabled:bg-slate-400",
  outline:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  children,
  ...props
}) {
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
  };

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${
        BUTTON_VARIANTS[variant]
      } ${sizes[size]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- badge */

const TONE_CLASSES = {
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  black: "bg-slate-900 text-white ring-slate-900",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

// Every status in the app maps to one of the palette tones.
const STATUS_TONES = {
  active: "blue",
  present: "blue",
  in_progress: "blue",
  open: "blue",
  downloaded: "blue",
  completed: "black",
  approved: "black",
  resolved: "black",
  critical: "black",
  high: "black",
  planning: "sky",
  pending: "sky",
  review: "sky",
  // A team leader asking for changes: waiting on the employee, not refused
  changes_required: "sky",
  assigned: "sky",
  half_day: "sky",
  lead: "sky",
  medium: "blue",
  low: "slate",
  available: "slate",
  inactive: "slate",
  on_hold: "slate",
  cancelled: "slate",
  closed: "slate",
  leave: "slate",
  absent: "red",
  rejected: "red",
};

export function Badge({ value, tone, children }) {
  const resolved = tone || STATUS_TONES[value] || "slate";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${TONE_CLASSES[resolved]}`}
    >
      {children || prettify(value) || "—"}
    </span>
  );
}

/* ------------------------------------------------------------ form field */

const inputClasses =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50";

// Controls fill their container unless the caller passes its own width class —
// Tailwind gives `w-full` and `w-32` equal specificity, so both would apply.
const fieldClasses = (className = "") =>
  `${inputClasses} ${/(^|\s)(w-|max-w-)/.test(className) ? "" : "w-full"} ${className}`;

export function Field({ label, hint, required, className = "", children }) {
  return (
    <div className={className}>
      {label && (
        <label className="mb-1 block text-xs font-medium text-slate-700">
          {label}
          {required && <span className="text-blue-600"> *</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export function Input(props) {
  return <input {...props} className={fieldClasses(props.className)} />;
}

export function Textarea(props) {
  return <textarea rows={3} {...props} className={`${fieldClasses(props.className)} resize-y`} />;
}

export function Select({ options = [], placeholder, children, ...props }) {
  return (
    <select {...props} className={fieldClasses(props.className)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const value = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? prettify(opt) : opt.label;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
      {children}
    </select>
  );
}

/**
 * Pick any number of options at once. Options may carry a `group` label, which
 * is what lets one list hold team leaders and employees together without the
 * caller having to choose a side first.
 *
 * `value` is an array of option values; `onChange` receives the next array.
 */
export function MultiSelect({
  options = [],
  value = [],
  onChange,
  placeholder = "Search…",
  emptyLabel = "Nothing to pick from",
  height = "max-h-52",
}) {
  const [query, setQuery] = useState("");

  const chosen = new Set(value.map(String));
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter((opt) => opt.label.toLowerCase().includes(needle))
    : options;

  const toggle = (optValue) => {
    const key = String(optValue);
    onChange(
      chosen.has(key) ? value.filter((v) => String(v) !== key) : [...value, optValue]
    );
  };

  // Group headings only earn their space when there is more than one group
  const groups = [...new Set(matches.map((opt) => opt.group || ""))].filter(Boolean);
  const showGroups = groups.length > 1;

  const row = (opt) => {
    const checked = chosen.has(String(opt.value));
    return (
      <label
        key={opt.value}
        className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
          checked ? "bg-blue-50 text-blue-900" : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggle(opt.value)}
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
        />
        <span className="truncate">{opt.label}</span>
      </label>
    );
  };

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      {options.length > 6 && (
        <div className="border-b border-slate-100 p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600"
          />
        </div>
      )}

      <div className={`${height} space-y-0.5 overflow-y-auto p-2`}>
        {!matches.length && (
          <p className="px-2 py-3 text-xs text-slate-400">
            {options.length ? "Nobody matches that search" : emptyLabel}
          </p>
        )}

        {showGroups
          ? groups.map((group) => (
              <div key={group} className="mb-1">
                <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {group}
                </p>
                {matches.filter((opt) => (opt.group || "") === group).map(row)}
              </div>
            ))
          : matches.map(row)}
      </div>
    </div>
  );
}

/** The chips that show what a MultiSelect currently holds. */
export function ChipList({ items = [], onRemove, empty }) {
  if (!items.length) {
    return empty ? <p className="text-xs text-slate-500">{empty}</p> : null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.value}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
        >
          {item.label}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.value)}
              className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-800"
              aria-label={`Remove ${item.label}`}
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- feedback */

export function Loader({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin text-blue-600" />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {Icon && (
        <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon size={20} />
        </span>
      )}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {message && <p className="max-w-sm text-xs text-slate-500">{message}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = "error", children }) {
  if (!children) return null;
  const tones = {
    error: "bg-red-50 text-red-700 ring-red-100",
    success: "bg-blue-50 text-blue-700 ring-blue-100",
  };
  return (
    <div className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- progress */

export function ProgressBar({ value = 0 }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{value}%</span>
    </div>
  );
}
