import adminApi from "../adminApi";
import createUnreadContext from "../../shared/hooks/createUnreadContext";

/**
 * How many notifications are waiting for this admin.
 *
 * The leader and employee panels keep this in their context provider, because
 * they each have one. The admin panel does not, so the same shape is built here
 * instead: one count shared by the topbar bell and the inbox, so marking things
 * read moves the badge instead of leaving it on a stale number.
 */
const { UnreadProvider, useUnread } = createUnreadContext(adminApi, "/admin");

export { UnreadProvider };
export default useUnread;
