import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/** Shared chrome for both the admin and team leader panels. */
export default function PanelLayout({
  navItems,
  brand,
  footer,
  user,
  profilePath,
  onLogout,
  topbarExtra,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        items={navItems}
        brand={brand}
        footer={footer}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-64">
        <Topbar
          items={navItems}
          user={user}
          profilePath={profilePath}
          onLogout={onLogout}
          onMenuClick={() => setSidebarOpen(true)}
          extra={topbarExtra}
        />
        <main className="px-4 py-6 lg:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
