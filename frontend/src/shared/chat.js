/**
 * Add a message to a thread, unless it is already in it.
 *
 * A message you send arrives twice, and both arrivals are correct. The server
 * saves it, pushes it to everyone watching the room — which includes you, since
 * you are subscribed to your own thread — and only then answers the POST. The
 * socket frame travels down a connection that is already open, so it usually
 * wins the race against the HTTP response coming back.
 *
 * Both deliveries carry the same saved row, so identity is `_id` and the second
 * one is dropped. Doing that check in only one of the two paths is what put
 * every message on screen twice for the sender while everyone else saw it once:
 * the socket handler skipped the copy it already had, and the send handler
 * appended its own regardless.
 *
 * Lives here rather than inside the component so the rule is one function, used
 * by both paths, and testable without rendering anything.
 */
export const withMessage = (list = [], message) => {
  if (!message?._id) return list;
  return list.some((row) => String(row._id) === String(message._id))
    ? list
    : [...list, message];
};
