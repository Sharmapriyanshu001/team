import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";

// Which group (if any) contains the current URL
const groupForPath = (items, pathname) =>
  items.find((item) => item.children?.some((child) => pathname.startsWith(child.to)))?.key;

/** "Something new is waiting here" — no count, just a mark. */
const Dot = () => (
  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-2 ring-red-500/25" />
);

/**
 * Panel navigation. `items` is a list of either links ({label, to, icon}) or
 * collapsible groups ({label, key, icon, children}).
 */
export default function Sidebar({ items, brand, footer, open, onClose }) {
  const { pathname } = useLocation();
  const activeGroup = groupForPath(items, pathname);

  const [openGroup, setOpenGroup] = useState(activeGroup);
  const [lastActiveGroup, setLastActiveGroup] = useState(activeGroup);

  // Follow the URL when navigating from outside the sidebar, without an effect.
  if (activeGroup !== lastActiveGroup) {
    setLastActiveGroup(activeGroup);
    if (activeGroup) setOpenGroup(activeGroup);
  }

  const linkClasses = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive
        ? "bg-blue-600 text-white font-medium"
        : "text-slate-400 hover:bg-white/5 hover:text-white"
    }`;

  const childClasses = ({ isActive }) =>
    `block rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors border-l-2 ${
      isActive
        ? "border-blue-500 bg-white/5 text-white font-medium"
        : "border-white/10 text-slate-400 hover:border-white/30 hover:text-white"
    }`;

  const BrandIcon = brand.icon;

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#0B0F1A] transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <BrandIcon size={17} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">{brand.title}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {brand.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const Icon = item.icon;

            if (item.action) {
              return (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Icon size={17} className="shrink-0" />
                  {item.label}
                </button>
              );
            }

            if (!item.children) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={linkClasses}
                >
                  <Icon size={17} className="shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.dot && <Dot />}
                  {item.badge > 0 && (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </NavLink>
              );
            }

            const expanded = openGroup === item.key;
            const hasActiveChild = item.children.some((c) => pathname.startsWith(c.to));

            return (
              <div key={item.key}>
                <button
                  onClick={() => setOpenGroup(expanded ? null : item.key)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    hasActiveChild
                      ? "text-white font-medium"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {/* Collapsed groups still have to show what is waiting inside */}
                  {(item.dot || item.children.some((c) => c.dot)) && <Dot />}
                  <ChevronDown
                    size={14}
                    className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>

                {expanded && (
                  <div className="mt-0.5 mb-1 ml-[26px] space-y-0.5">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        onClick={onClose}
                        className={childClasses}
                      >
                        <span className="flex items-center gap-2">
                          <span className="flex-1">{child.label}</span>
                          {child.dot && <Dot />}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/10 px-5 py-3">
          <p className="text-[10px] text-slate-500">{footer}</p>
        </div>
      </aside>
    </>
  );
}
