import salesApi from "../salesApi";
import createUnreadContext from "../../shared/hooks/createUnreadContext";

/**
 * How many notifications are waiting for this sales account.
 *
 * One count shared by the topbar bell and the inbox, so marking things read
 * moves the badge rather than leaving a lead looking unopened.
 */
const { UnreadProvider, useUnread } = createUnreadContext(salesApi, "/sales");

export { UnreadProvider };
export default useUnread;
