import Client from "../../models/Client.js";

/**
 * The client details Sales has sent through to HR.
 *
 * Read-only on purpose. HR is not running the commercial relationship — Sales
 * owns the account and Operations delivers it — so this screen exists to
 * answer one question well: what has come through, from whom, and what did
 * they say about it.
 *
 * A client appears here the moment somebody in Sales presses Send to HR, and
 * not before. That is the difference between this and the admin's client list,
 * which shows every client whether or not anybody meant HR to see it.
 */

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shape = (client) => ({
  _id: client._id,
  name: client.name,
  company: client.company || "",
  email: client.email,
  phone: client.phone || "",
  address: client.address || "",
  gstNumber: client.gstNumber || "",
  notes: client.notes || "",
  status: client.status,
  owner: client.owner || null,
  accountManager: client.accountManager || null,
  sharedWithHr: client.sharedWithHr || null,
  createdAt: client.createdAt,
});

// GET /api/hr/client-records?search=
export const listClientRecords = async (req, res) => {
  try {
    /**
     * `sharedWithHr.at` being set is what "sent to HR" means. The date is
     * tested rather than the sub-document, because an empty sub-document is
     * what mongoose leaves behind on a client nobody has sent.
     */
    const query = { "sharedWithHr.at": { $exists: true, $ne: null } };

    const search = String(req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { name: regex },
        { company: regex },
        { email: regex },
        { phone: regex },
        { gstNumber: regex },
      ];
    }

    const items = await Client.find(query)
      .select("-password")
      .populate("owner", "name email")
      .populate("accountManager", "name email")
      .populate("sharedWithHr.by", "name")
      .sort({ "sharedWithHr.at": -1 })
      .limit(300);

    return res.status(200).json({ items: items.map(shape), total: items.length });
  } catch (err) {
    console.error("listClientRecords error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/hr/client-records/:id
export const getClientRecord = async (req, res) => {
  try {
    const client = await Client.findOne({
      _id: req.params.id,
      "sharedWithHr.at": { $exists: true, $ne: null },
    })
      .select("-password")
      .populate("owner", "name email")
      .populate("accountManager", "name email")
      .populate("sharedWithHr.by", "name");

    /**
     * A client Sales has not sent is answered as missing rather than refused.
     * HR has no business learning which clients exist but were not shared.
     */
    if (!client) return res.status(404).json({ message: "That record was not found" });

    return res.status(200).json({ item: shape(client) });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That record was not found" });
    }
    console.error("getClientRecord error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
