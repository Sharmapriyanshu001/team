import { Link } from "react-router-dom";
import { Briefcase, Bell } from "lucide-react";

import PanelLayout from "../../shared/layout/PanelLayout";
import { buildNavItems } from "../navigation";
import { useClient } from "../clientContext";
import useSignOut from "../../shared/useSignOut";

export default function ClientLayout() {
  const { client, flags, unread } = useClient();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "clientToken",
    userKey: "client",
    loginPath: "/client/login",
    panel: "the client portal",
  });

  const navItems = buildNavItems({
    leaderChatEnabled: flags.leaderChatEnabled,
    employeeChatEnabled: flags.employeeChatEnabled,
    unread,
    onLogout: askSignOut,
  });

  // The topbar avatar reads `name`, so pass the contact with the company below
  const user = client
    ? { name: client.name, email: client.company || client.email }
    : null;

  return (
    <>
      <PanelLayout
        navItems={navItems}
        brand={{ title: "Client Portal", subtitle: flags.companyName || "JHA Company", icon: Briefcase }}
        footer={`${flags.companyName || "JHA Company"} · Client Portal`}
        user={user}
        profilePath="/client/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/client/notifications"
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
