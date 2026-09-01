import { CHART } from "../../../shared/theme";

import { formatValue } from "./constants";

/**
 * How a target is going.
 *
 * The bar fills with progress, and the thin marker behind it is where the
 * target ought to be by today. That second mark is the whole point: 40% is
 * ahead on the 5th and a problem on the 28th, and without somewhere to compare
 * it to every open target looks behind for most of the month — which is the
 * fastest way to teach people to ignore the colour entirely.
 */
export default function Progress({ target }) {
  const percent = target.percent ?? 0;
  const width = Math.min(100, Math.max(0, percent));

  const hit = percent >= 100;
  const behind = target.onTrack === false;

  const fill = hit ? "#15803D" : behind ? "#D97706" : CHART.blue;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate text-slate-700">
          {target.label}
          {!target.auto && <span className="ml-1.5 text-[11px] text-slate-400">entered</span>}
        </span>
        <span className="shrink-0 tabular-nums text-slate-900">
          {formatValue(target.actual, target.unit)}
          <span className="text-slate-400"> / {formatValue(target.targetValue, target.unit)}</span>
        </span>
      </div>

      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          style={{ width: `${width}%`, background: fill }}
          className="h-full rounded-full transition-all"
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className={hit ? "text-green-700" : behind ? "text-amber-700" : "text-slate-400"}>
          {hit
            ? "Hit"
            : behind
              ? "Behind for this point in the month"
              : `${Math.round(percent)}% — on track`}
        </span>
        {!hit && (
          <span className="text-slate-400">
            {formatValue(target.remaining, target.unit)} to go
          </span>
        )}
      </div>
    </div>
  );
}
