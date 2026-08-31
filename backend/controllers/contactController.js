import Contact from "../models/Contact.js";

// POST /api/contact
export const createContact = async (req, res) => {
  try {
    const { name, email, note } = req.body;

    if (!name || !email || !note) {
      return res
        .status(400)
        .json({ message: "Name, email and note are required" });
    }

    const contact = await Contact.create({ name, email, note });

    return res.status(201).json({
      message: "Message sent successfully",
      contact,
    });
  } catch (err) {
    console.error("createContact error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
