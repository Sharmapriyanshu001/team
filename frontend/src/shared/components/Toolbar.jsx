import { Search } from "lucide-react";
import { Select } from "./ui";

/**
 * Search box plus a row of dropdown filters, sitting above a DataTable.
 * filters: [{ key, value, placeholder, options }]
 */
export default function Toolbar({
  search,
  onSearch,
  searchPlaceholder = "Search...",
  filters = [],
  onFilter,
  children,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      <div className="relative min-w-[200px] flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
        />
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={filter.value ?? ""}
          onChange={(e) => onFilter(filter.key, e.target.value)}
          options={filter.options}
          placeholder={filter.placeholder}
          className="w-auto min-w-[140px]"
        />
      ))}

      {children}
    </div>
  );
}
