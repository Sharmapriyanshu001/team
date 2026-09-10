import { Link } from "react-router-dom";
import { Bell, Handshake } from "lucide-react";

import PanelLayout from "../../shared/layout/PanelLayout";
import { readStoredUser } from "../../shared/createApi";
import useSignOut from "../../shared/useSignOut";
import { navItemsFor, visibleNavItems } from "../navigation";
import useSalesAccess from "../hooks/useSalesAccess";
import useNewTasks from "../hooks/useNewTasks";
import useUnread from "../hooks/useUnread";

export default function SalesLayout() {
  const sales = readStoredUser("sales");
  const { can, isSalesHead } = useSalesAccess();
  const { unread } = useUnread();
  const { newTasks } = useNewTasks();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "salesToken",
    userKey: "sales",
    loginPath: "/",
    panel: "the Sales panel",
  });

  return (
    <>
      <PanelLayout
        // Sections this account cannot reach are left out. The server refuses
        // them either way; this only avoids offering a door that will not open.
        navItems={visibleNavItems(navItemsFor({ newTasks, isSalesHead }), can)}
        brand={{
          title: "JHA Sales",
          subtitle: isSalesHead ? "Sales Head" : "Sales Executive",
          icon: Handshake,
        }}
        footer="JHA Company · Sales"
        user={sales}
        profilePath="/sales/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/sales/notifications"
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
