import { useCallback, useEffect, useState } from "react";
import clientApi from "./clientApi";
import useLiveNotifications from "../shared/hooks/useLiveNotifications";
import { readStoredUser } from "../shared/createApi";
import { ClientContext } from "./clientContext";

const NO_FLAGS = { leaderChatEnabled: false, employeeChatEnabled: false, companyName: "" };

/**
 * Session-wide state for the client portal: who is signed in, which chat tabs
 * the admin has enabled, and the unread notification count.
 */
export default function ClientProvider({ children }) {
  const [client, setClient] = useState(() => readStoredUser("client"));
  const [flags, setFlags] = useState(NO_FLAGS);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;

    clientApi
      .get("/client/me")
      .then(({ data }) => {
        if (!active) return;
        setClient(data.client);
        setFlags({ ...NO_FLAGS, ...data.flags });
        localStorage.setItem("client", JSON.stringify(data.client));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const refreshUnread = useCallback(() => {
    clientApi
      .get("/client/notifications", { params: { filter: "unread" } })
      .then(({ data }) => setUnread(data.unread || 0))
      .catch(() => setUnread(0));
  }, []);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  /**
   * A notification pushed to this account updates the badge at once, so
   * nobody has to reload a page to find out something happened to them.
   */
  useLiveNotifications("/client", refreshUnread);

  return (
    <ClientContext.Provider value={{ client, setClient, flags, unread, refreshUnread }}>
      {children}
    </ClientContext.Provider>
  );
}
