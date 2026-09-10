import { Link, useLocation } from "react-router-dom";
import { Menu, LogOut } from "lucide-react";
import { initialsOf, prettify } from "../format";

/**
 * A path segment that is a record's id rather than a place — the ":id" of a
 * detail route. Printing one as a breadcrumb says nothing to anybody, and
 * ignoring it entirely is worse: a single client's page would then be labelled
 * "All Clients", which is not where the person is.
 */
const isRecordId = (segment) => /^[0-9a-f]{24}$/i.test(segment);

// Derive the breadcrumb ("Employees / Attendance") from the nav tree.
const crumbsFor = (items, pathname) => {
  const segments = pathname.split("/").filter(Boolean);
  const detail = isRecordId(segments[segments.length - 1] || "");

  // The list this record belongs to, so "/admin/clients/<id>" is matched
  // against "/admin/clients" rather than against nothing
  const base = detail ? `/${segments.slice(0, -1).join("/")}` : pathname;

  for (const item of items) {
    if (item.children) {
      const child = item.children.find((c) => c.to === base);
      if (child) return [item.label, child.label, ...(detail ? ["Details"] : [])];

      /**
       * A longer child path wins. Two children where one is a prefix of the
       * other — "/admin/clients" and "/admin/clients/handover" — would
       * otherwise be decided by their order in the nav rather than by which
       * one the person is actually on.
       */
      const partial = item.children
        .filter((c) => base.startsWith(`${c.to}/`))
        .sort((a, b) => b.to.length - a.to.length)[0];
      if (partial) return [item.label, partial.label, ...(detail ? ["Details"] : [])];
    } else if (item.to === base) {
      return [item.label, ...(detail ? ["Details"] : [])];
    }
  }

  // Routes that are not in the sidebar (a stat card's breakdown, say) fall back
  // to the last two path segments so the crumb still says something useful.
  const parts = segments.slice(1);
  if (parts.length) return parts.slice(-2).map((part) => (isRecordId(part) ? "Details" : prettify(part)));

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
