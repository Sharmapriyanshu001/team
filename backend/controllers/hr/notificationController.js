import Notification from "../../models/Notification.js";

/**
 * The HR panel's inbox.
 *
 * The rows were already being written and nobody could read them. An employee
 * applying for leave notifies every active HR account, and hiring does the
 * same — but the HR panel had no route that returned any of it, so a request
 * arrived and the person who had to act on it was never told. This is the
 * missing end of a pipe that was already laid.
 *
 * Deliberately its own controller rather than reusing the admin one. That one
 * reads `req.admin._id`, and hrAuth sets only `req.hr` — aliasing the two so
 * the admin handlers would work here would make every `if (req.admin)` in
 * shared code silently true for an HR account, which utils/activity.js in
 * particular branches on. Keeping them distinct costs three small handlers.
 *
 * Same three endpoints, same query, same response shape as the admin and
 * leader inboxes, so the shared NotificationsPanel component works here
 * without knowing which panel it is mounted in.
 */

// GET /api/hr/notifications?filter=unread&type=general
export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.hr._id };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      /**
       * Always the full unread count, never the filtered one — it is the
       * number on the bell, and a filter is not supposed to change what is
       * waiting.
       */
      Notification.countDocuments({ user: req.hr._id, read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("hr listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/hr/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      // Scoped to the reader, so one HR account cannot mark another's inbox read
      { _id: req.params.id, user: req.hr._id },
      { $set: { read: true } },
      { returnDocument: "after" }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Notification not found" });
    }
    console.error("hr markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/hr/notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.hr._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("hr markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
