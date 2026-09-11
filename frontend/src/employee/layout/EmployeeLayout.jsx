import { Link } from "react-router-dom";
import { UserRound, Bell } from "lucide-react";

import PanelLayout from "../../shared/layout/PanelLayout";
import { buildNavItems } from "../navigation";
import { useEmployee } from "../employeeContext";
import useSignOut from "../../shared/useSignOut";

export default function EmployeeLayout() {
  const { employee, flags, tools, unread, newTasks } = useEmployee();

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "employeeToken",
    userKey: "employee",
    loginPath: "/",
    panel: "your workspace",
  });

  const navItems = buildNavItems({
    clientChatEnabled: flags.clientChatEnabled,
    tools,
    unread,
    newTasks,
    onLogout: askSignOut,
  });

  return (
    <>
      <PanelLayout
        navItems={navItems}
        brand={{ title: "JHA Workspace", subtitle: "Employee", icon: UserRound }}
        footer="JHA Company · Employee"
        user={employee}
        profilePath="/employee/profile"
        onLogout={askSignOut}
        topbarExtra={
          <Link
            to="/employee/notifications"
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
