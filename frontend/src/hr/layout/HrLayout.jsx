import { Bell, Users } from "lucide-react";
import { Link } from "react-router-dom";

import PanelLayout from "../../shared/layout/PanelLayout";
import { readStoredUser } from "../../shared/createApi";
import useSignOut from "../../shared/useSignOut";
import { NAV_ITEMS, visibleNavItems } from "../navigation";
import useHrAccess from "../hooks/useHrAccess";
import useUnread from "../hooks/useUnread";

export default function HrLayout() {
  const hr = readStoredUser("hr");
  const { can, isHrAdmin } = useHrAccess();
  const { unread } = useUnread();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "hrToken",
    userKey: "hr",
    loginPath: "/",
    panel: "the HR panel",
  });

  return (
    <>
      <PanelLayout
        navItems={visibleNavItems(NAV_ITEMS, can)}
        brand={{
          title: "JHA HR",
          subtitle: isHrAdmin ? "HR Head" : "HR Manager",
          icon: Users,
        }}
        footer="JHA Company · HR"
        user={hr}
        profilePath="/hr/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/hr/notifications"
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
