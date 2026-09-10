import { Link } from "react-router-dom";
import { HardHat, Bell } from "lucide-react";

import PanelLayout from "../../shared/layout/PanelLayout";
import { buildNavItems } from "../navigation";
import { useLeader } from "../leaderContext";
import useSignOut from "../../shared/useSignOut";

export default function LeaderLayout() {
  const { leader, flags, unread, newTasks } = useLeader();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "leaderToken",
    userKey: "leader",
    loginPath: "/",
    panel: "the team panel",
  });

  const navItems = buildNavItems({
    clientChatEnabled: flags.clientChatEnabled,
    unread,
    newTasks,
    onLogout: askSignOut,
  });

  return (
    <>
      <PanelLayout
        navItems={navItems}
        brand={{ title: "JHA Operations", subtitle: "Operations Manager", icon: HardHat }}
        footer="JHA Company · Operations Manager"
        user={leader}
        profilePath="/operation-manager/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/operation-manager/notifications"
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
