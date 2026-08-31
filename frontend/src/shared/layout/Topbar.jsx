import { Link, useLocation } from "react-router-dom";
import { Menu, LogOut } from "lucide-react";
import { initialsOf, prettify } from "../format";

// Derive the breadcrumb ("Employees / Attendance") from the nav tree.
const crumbsFor = (items, pathname) => {
  for (const item of items) {
    if (item.children) {
      const child = item.children.find((c) => c.to === pathname);
      if (child) return [item.label, child.label];
      const partial = item.children.find((c) => pathname.startsWith(c.to));
      if (partial) return [item.label, partial.label];
    } else if (item.to === pathname) {
      return [item.label];
    }
  }

  // Routes that are not in the sidebar (a stat card's breakdown, say) fall back
  // to the last two path segments so the crumb still says something useful.
  const parts = pathname.split("/").filter(Boolean).slice(1);
  if (parts.length) return parts.slice(-2).map(prettify);

  return ["Dashboard"];
};

export default function Topbar({ items, user, profilePath, onLogout, onMenuClick, extra }) {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(items, pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
      >
        <Menu size={19} />
      </button>

      <div className="min-w-0 flex-1">
        <nav className="flex items-center gap-1.5 text-xs text-slate-400">
          {crumbs.map((crumb, i) => (
            <span key={crumb} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-300">/</span>}
              <span className={i === crumbs.length - 1 ? "text-slate-700" : ""}>{crumb}</span>
            </span>
          ))}
        </nav>
        <p className="truncate text-sm font-semibold text-slate-900">
          {crumbs[crumbs.length - 1]}
        </p>
      </div>

      {extra}

      <Link
        to={profilePath}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          {initialsOf(user?.name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-slate-900">{user?.name || "User"}</span>
          <span className="block text-[11px] text-slate-500">{user?.email}</span>
        </span>
      </Link>

      <button
        onClick={onLogout}
        title="Logout"
        className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-red-600"
      >
        <LogOut size={16} />
      </button>
    </header>
  );
}
