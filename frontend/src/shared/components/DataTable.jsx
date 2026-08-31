import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Loader, EmptyState } from "./ui";

/**
 * columns: [{ key, header, render?, className?, width? }]
 * rows:    array of records (each needs a stable `_id` or `id`)
 */
export default function DataTable({
  columns,
  rows = [],
  loading = false,
  emptyTitle = "Nothing here yet",
  emptyMessage,
  page = 1,
  pages = 1,
  total = 0,
  onPageChange,
  onRowClick,
}) {
  if (loading) return <Loader />;

  if (!rows.length) {
    return <EmptyState icon={Inbox} title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap ${
                    col.className || ""
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row._id || row.id || index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 align-middle text-slate-700 ${col.className || ""}`}
                  >
                    {col.render ? col.render(row, index) : row[col.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            Page {page} of {pages} · {total} records
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pages}
              className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
