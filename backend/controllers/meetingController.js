import Meeting, { MEETING_MODES, MEETING_STATUS } from "../models/Meeting.js";
import { logActivity } from "../utils/activity.js";
import { notifyClient } from "../utils/notify.js";
import { newMeetLink } from "../utils/meetLink.js";

/**
 * Meetings, from the company's side.
 *
 * Clients could already ask for one; nobody could see the ask. The request
 * landed as a notification pointing at the client list, which is not a place a
 * meeting appears — so the only way to answer one was to have been watching
 * when it arrived. This is the other half: the list of what has been asked
 * for, the link to join it, and the four things anybody would want to do
 * about it.
 *
 * Deliberately not built on buildCrud. Confirming, cancelling and closing a
 * meeting are not "edit the status field" — each one has to reach the client
 * who is waiting on an answer, and a generic update would let a stray field in
 * a payload move a meeting between states with nobody told.
 */

const POPULATE = [
  { path: "client", select: "name company email phone" },
  { path: "project", select: "name code" },
  { path: "organizer", select: "name designation email" },
];

const withRefs = (query) => POPULATE.reduce((q, p) => q.populate(p), query);

const tellClient = (meeting, payload) =>
  notifyClient(meeting.client?._id || meeting.client, { type: "system", ...payload });

const whenText = (date) =>
  new Date(date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

// GET /api/admin/meetings
export const listMeetings = async (req, res) => {
  try {
    const query = {};

    if (req.query.status && req.query.status !== "all") query.status = req.query.status;
    if (req.query.client) query.client = req.query.client;

    const items = await withRefs(Meeting.find(query)).sort({ scheduledAt: -1 }).limit(200);

    const now = new Date();

    return res.status(200).json({
      items,
      total: items.length,
      summary: {
        // What somebody opening this screen is here to deal with
        requested: items.filter((m) => m.status === "requested").length,
        upcoming: items.filter((m) => m.status === "scheduled" && m.scheduledAt >= now).length,
        completed: items.filter((m) => m.status === "completed").length,
      },
    });
  } catch (err) {
    console.error("admin listMeetings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/admin/meetings/:id
 *
 * Confirming a request, moving it, or writing down what was decided. Only the
 * fields actually sent are touched, so confirming a meeting does not need the
 * whole record echoed back at it.
 */
export const updateMeeting = async (req, res) => {
  try {
    const meeting = await withRefs(Meeting.findById(req.params.id));
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    const before = { status: meeting.status, scheduledAt: meeting.scheduledAt };
    const { status, scheduledAt, durationMinutes, mode, location, notes, title, agenda } = req.body;

    if (status !== undefined) {
      if (!MEETING_STATUS.includes(status)) {
        return res.status(400).json({ message: "That is not a meeting status" });
      }
      meeting.status = status;
    }

    if (title !== undefined) meeting.title = String(title).trim() || meeting.title;
    if (agenda !== undefined) meeting.agenda = String(agenda).trim();
    if (notes !== undefined) meeting.notes = String(notes).trim();

    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ message: "That is not a valid time" });
      }
      meeting.scheduledAt = when;
    }

    if (durationMinutes !== undefined) {
      meeting.durationMinutes = Number(durationMinutes) || meeting.durationMinutes;
    }

    if (mode !== undefined && MEETING_MODES.includes(mode)) {
      const wasOnline = meeting.mode === "online";
      meeting.mode = mode;

      /**
       * Moving a meeting online after the fact needs a link, and moving it off
       * needs the link gone — an address field still holding a Meet URL is how
       * somebody ends up sitting in an empty call while everyone else is at
       * the office.
       */
      if (mode === "online" && !wasOnline) meeting.location = newMeetLink("online");
      if (mode !== "online" && wasOnline) meeting.location = "";
    }

    // An explicit location always wins — a real Meet link pasted in, or the
    // address of the office somebody is actually going to
    if (location !== undefined) meeting.location = String(location).trim();

    // The admin answering the request is the one running it, unless somebody
    // has already been put down for it
    if (meeting.status === "scheduled" && !meeting.organizer) {
      meeting.organizer = req.admin._id;
    }

    await meeting.save();

    logActivity(req, {
      action: "updated",
      entity: "Meeting",
      entityId: meeting._id,
      message: `${req.admin.name} ${
        before.status !== meeting.status ? `${meeting.status} ` : "updated "
      }meeting "${meeting.title}"`,
    });

    /* ------------------------------------------------- tell the client */

    const moved = scheduledAt && String(before.scheduledAt) !== String(meeting.scheduledAt);

    if (before.status !== meeting.status && meeting.status === "scheduled") {
      tellClient(meeting, {
        title: "Your meeting is confirmed",
        message: `${meeting.title} — ${whenText(meeting.scheduledAt)}`,
        link: "/client/meetings",
      });
    } else if (before.status !== meeting.status && meeting.status === "cancelled") {
      tellClient(meeting, {
        title: "A meeting was cancelled",
        message: meeting.title,
        link: "/client/meetings",
      });
    } else if (moved) {
      tellClient(meeting, {
        title: "Your meeting was moved",
        message: `${meeting.title} — now ${whenText(meeting.scheduledAt)}`,
        link: "/client/meetings",
      });
    }

    const item = await withRefs(Meeting.findById(meeting._id));
    return res.status(200).json({ message: "Meeting updated", item });
  } catch (err) {
    console.error("admin updateMeeting error:", err);
    if (err.name === "CastError") return res.status(404).json({ message: "Meeting not found" });
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/admin/meetings/:id/link
 *
 * A fresh join link, for when the old one is stale or was never right. Kept
 * apart from the update above so it reads as what it is at the call site, and
 * so regenerating cannot happen as a side effect of saving something else.
 */
export const regenerateLink = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    if (meeting.mode !== "online") {
      return res.status(400).json({ message: "This meeting is not being held online" });
    }

    meeting.location = newMeetLink("online");
    await meeting.save();

    logActivity(req, {
      action: "updated",
      entity: "Meeting",
      entityId: meeting._id,
      message: `${req.admin.name} made a new join link for "${meeting.title}"`,
    });

    tellClient(meeting, {
      title: "New joining link",
      message: `${meeting.title} has a new link`,
      link: "/client/meetings",
    });

    const item = await withRefs(Meeting.findById(meeting._id));
    return res.status(200).json({ message: "New link created", item });
  } catch (err) {
    console.error("admin regenerateLink error:", err);
    if (err.name === "CastError") return res.status(404).json({ message: "Meeting not found" });
    return res.status(500).json({ message: "Server error" });
  }
};
