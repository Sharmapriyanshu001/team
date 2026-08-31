import Notification from "../models/Notification.js";

/**
 * The admin's notification inbox.
 *
 * Everything else in the app had one already — the team leader, the employee
 * and the client each get their own — and plenty of code was dutifully writing
 * rows for admins the whole time: a client sending a message or asking for a
 * meeting, an employee submitting code, a delete request, a project being
 * binned. Those rows were being created and then read by nobody, because the
 * admin panel had no route that returned them.
 *
 * So this is the missing end of a pipe that was already laid, not a new
 * feature bolted on. Deliberately the same three endpoints, the same query and
 * the same shape as the leader's, so the shared inbox component on the front
 * end works here without knowing which panel it is mounted in.
 */

// GET /api/admin/notifications?filter=unread&type=chat
export const listNotifications = async (req, res) => {
  try {
    const query = { user: req.admin._id };
    if (req.query.filter === "unread") query.read = false;
    if (req.query.type && req.query.type !== "all") query.type = req.query.type;

    const [items, unread] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).limit(100),
      // Always the full unread count, never the filtered one — it is the number
      // on the bell, and a filter is not supposed to change what is waiting
      Notification.countDocuments({ user: req.admin._id, read: false }),
    ]);

    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("admin listNotifications error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      // Scoped to the reader, so one admin cannot mark another's inbox read
      { _id: req.params.id, user: req.admin._id },
      { $set: { read: true } },
      { returnDocument: "after" }
    );

    if (!updated) return res.status(404).json({ message: "Notification not found" });
    return res.status(200).json({ message: "Marked as read", item: updated });
  } catch (err) {
    console.error("admin markNotificationRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/admin/notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.admin._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ message: "All caught up", updated: result.modifiedCount });
  } catch (err) {
    console.error("admin markAllRead error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
