import hrApi from "../hrApi";
import createUnreadContext from "../../shared/hooks/createUnreadContext";

/**
 * How many notifications are waiting for this HR account.
 *
 * One count shared by the topbar bell and the inbox, so marking things read
 * moves the badge — which matters here, where what is waiting is somebody's
 * leave request.
 */
const { UnreadProvider, useUnread } = createUnreadContext(hrApi, "/hr");

export { UnreadProvider };
export default useUnread;
