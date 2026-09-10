import { Link } from "react-router-dom";
import { Building2, Bell } from "lucide-react";

import PanelLayout from "../../shared/layout/PanelLayout";
import { readStoredUser } from "../../shared/createApi";
import useSignOut from "../../shared/useSignOut";
import { NAV_ITEMS, visibleNavItems } from "../navigation";
import usePermissions from "../hooks/usePermissions";
import useUnread from "../hooks/useUnread";

export default function AdminLayout() {
  const admin = readStoredUser("admin");
  const { can, isSuperAdmin, isFullAdmin, departmentLabel } = usePermissions();
  const { unread } = useUnread();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "adminToken",
    userKey: "admin",
    loginPath: "/",
    panel: "the admin panel",
  });

  return (
    <>
      <PanelLayout
        // Sections this account cannot reach are left out. The server refuses
        // them either way; this only avoids offering a door that will not open.
        navItems={visibleNavItems(NAV_ITEMS, can, { isFullAdmin })}
        brand={{
          title: "JHA Admin",
          /**
           * A department account signing in and being greeted as "Control
           * Panel" is a small thing that makes a person wonder whether they
           * are in the right place. Their department is named instead.
           */
          subtitle: isSuperAdmin
            ? "Super Admin"
            : departmentLabel || "Control Panel",
          icon: Building2,
        }}
        footer="JHA Company · v1.0"
        user={admin}
        profilePath="/admin/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/admin/notifications"
            title="Notifications"
            className="relative rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-blue-600"
          >
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        }
      />
      {signOutDialog}
    </>
  );
}
