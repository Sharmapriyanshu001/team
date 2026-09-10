import Notification from "../../models/Notification.js";

/**
 * The Sales panel's inbox.
 *
 * Its own controller rather than the admin one, which reads `req.admin._id` —
 * salesAuth sets only `req.sales`, and aliasing the two so the admin handlers
 * would work here would make every `if (req.admin)` in shared code silently
 * true for a sales account. utils/activity.js in particular branches on it.
 * Keeping them distinct costs three small handlers.
 *
 * Same three endpoints, same query and the same response shape as the other
 * four inboxes, so the shared NotificationsPanel component works here without
 * knowing which panel it is mounted in.
 */

// GET /api/sales/notifications?filter=unread&type=assignment
export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.sales._id };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      // Always the full unread count, never the filtered one — it is the number
      // on the bell, and a filter is not supposed to change what is waiting
      Notification.countDocuments({ user: req.sales._id, read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("sales listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/sales/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      // Scoped to the reader, so one account cannot mark another's inbox read
      { _id: req.params.id, user: req.sales._id },
      { $set: { read: true } },
      { returnDocument: "after" }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Notification not found" });
    }
    console.error("sales markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/sales/notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.sales._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("sales markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
