import Candidate, {
  OPEN_STAGES,
  SELECTED_STAGES,
  STAGE_ORDER,
} from "../../models/Candidate.js";
import JobOpening from "../../models/JobOpening.js";
import User from "../../models/User.js";

import { buildCrud, InvalidInput } from "../../utils/crud.js";
import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";

/**
 * Hiring, end to end: a vacancy, the people who applied for it, the rounds
 * they sat, the decisions taken, and the day one of them becomes an employee.
 *
 * The chain is
 *
 *   Job Opening → Candidate → Interview → Shortlisted → Selected
 *                                                          ↓
 *                                       Employee ← Onboarding
 *
 * and every link in it is a stored reference rather than a convention, so the
 * board can answer "how is this vacancy going" without anybody having to keep
 * a spreadsheet beside it.
 */

const actorOf = (req) => req.hr || req.admin;

/** The default checklist a new onboarding starts with. */
const DEFAULT_CHECKLIST = [
  "Offer letter sent",
  "Offer accepted",
  "Identity documents collected",
  "Bank details collected",
  "Joining date agreed",
  "Workspace and accounts requested",
];

/* -------------------------------------------------------------- openings */

/**
 * A short handle for an opening — "ENG-03" — derived from the department so
 * it reads like something rather than being a number nobody can place.
 */
const nextCode = async (department) => {
  const prefix = (department || "JOB").replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "JOB";
  const count = await JobOpening.countDocuments({ code: new RegExp(`^${prefix}-`) });
  return `${prefix}-${String(count + 1).padStart(2, "0")}`;
};

export const openings = buildCrud(JobOpening, {
  entity: "Job opening",
  searchFields: ["title", "code", "department", "location", "skills"],
  filterFields: ["status", "department", "employmentType", "owner"],
  populate: [
    { path: "owner", select: "name email" },
    { path: "reportsTo", select: "name designation" },
  ],
  sort: { createdAt: -1 },

  beforeSave: async (payload, req, existing) => {
    const data = { ...payload };

    if (data.owner === "") data.owner = null;
    if (data.reportsTo === "") data.reportsTo = null;

    ["requirements", "skills"].forEach((field) => {
      // Either a list or a comma-separated line, depending on which form is open
      if (typeof data[field] === "string") {
        data[field] = data[field]
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    });

    if (data.positions !== undefined && Number(data.positions) < 1) {
      throw new InvalidInput("An opening has to be for at least one position");
    }
    if (
      data.salaryMin &&
      data.salaryMax &&
      Number(data.salaryMin) > Number(data.salaryMax)
    ) {
      throw new InvalidInput("The minimum salary is above the maximum");
    }

    if (!existing) {
      data.createdBy = actorOf(req)?._id;
      if (!data.code) data.code = await nextCode(data.department);
    }

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    if (!doc.owner) return;
    if (!isNew && String(previous?.owner || "") === String(doc.owner)) return;

    notifyUser(doc.owner, {
      type: "assignment",
      title: "A job opening was assigned to you",
      message: `${doc.title}${doc.department ? ` — ${doc.department}` : ""}`,
      link: "/hr/hiring/openings",
    });
  },
});

/**
 * GET /api/hr/hiring/openings/:id/detail
 *
 * One vacancy with its pipeline hanging off it — which is the only way to read
 * whether it is going well.
 */
export const openingDetail = async (req, res) => {
  try {
    const opening = await JobOpening.findById(req.params.id)
      .populate("owner", "name email designation")
      .populate("reportsTo", "name designation");

    if (!opening) return res.status(404).json({ message: "Job opening not found" });

    const [candidates, byStage] = await Promise.all([
      Candidate.find({ jobOpening: opening._id })
        .select("name email phone stage source position interviews createdAt hiredAt rejectedAt")
        .populate("hiredUser", "name email")
        .sort({ createdAt: -1 }),
      Candidate.aggregate([
        { $match: { jobOpening: opening._id } },
        { $group: { _id: "$stage", count: { $sum: 1 } } },
      ]),
    ]);

    const pipeline = {};
    byStage.forEach((row) => {
      pipeline[row._id] = row.count;
    });

    const hired = pipeline.hired || 0;

    return res.status(200).json({
      item: opening,
      candidates,
      pipeline,
      stats: {
        applicants: candidates.length,
        inPlay: candidates.filter((c) => OPEN_STAGES.includes(c.stage)).length,
        hired,
        // What is still to fill. Never negative — over-hiring an opening is a
        // real thing and reads better as "filled" than as "-1 remaining".
        remaining: Math.max(0, (opening.positions || 1) - hired),
        rejected: pipeline.rejected || 0,
        interviews: candidates.reduce((sum, c) => sum + (c.interviews?.length || 0), 0),
      },
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Job opening not found" });
    }
    console.error("openingDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- the stages */

/**
 * PUT /api/hr/hiring/candidates/:id/stage   { stage, reason }
 *
 * Moving somebody along the pipeline.
 *
 * Its own route rather than a field on the candidate edit, for the same reason
 * approving a leave is: it is the change that has to be recorded, it notifies
 * people, and it is refused in the two cases an edit form would happily allow.
 */
export const moveStage = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const stage = String(req.body.stage || "").trim();

    if (!STAGE_ORDER.includes(stage) && stage !== "rejected") {
      return res.status(400).json({ message: "That is not a stage a candidate can be moved to" });
    }

    /**
     * "hired" is not a move — it is the result of onboarding, which creates
     * the person's account. Allowing it here would mark somebody hired with no
     * login to show for it, which is the same hole the candidate edit form has
     * been refused for since Recruitment existed.
     */
    if (stage === "hired") {
      return res.status(400).json({
        message: "Complete onboarding to hire this candidate — it creates their account",
      });
    }

    if (candidate.hiredUser) {
      return res.status(409).json({ message: "This candidate has already been hired" });
    }

    const from = candidate.stage;
    if (from === stage) {
      return res.status(200).json({ message: "Already there", item: candidate });
    }

    candidate.stage = stage;
    if (stage === "rejected") {
      candidate.rejectionReason = String(req.body.reason || "").trim();
    }

    /**
     * Reaching "selected" is what opens onboarding, so the checklist is put
     * there now rather than making somebody press a second button for it.
     * Only once — a candidate moved out and back keeps the boxes they ticked.
     */
    if (SELECTED_STAGES.includes(stage) && !candidate.onboarding?.startedAt) {
      candidate.onboarding = {
        ...(candidate.onboarding?.toObject?.() || candidate.onboarding || {}),
        startedAt: new Date(),
        designation: candidate.onboarding?.designation || candidate.position || "",
        department: candidate.onboarding?.department || candidate.department || "",
        checklist: candidate.onboarding?.checklist?.length
          ? candidate.onboarding.checklist
          : DEFAULT_CHECKLIST.map((label) => ({ label, done: false })),
      };
    }

    await candidate.save();

    logActivity(req, {
      action: "updated",
      entity: "Candidate",
      entityId: candidate._id,
      message: `${candidate.name} moved from ${from.replace(/_/g, " ")} to ${stage.replace(/_/g, " ")}`,
    });

    if (candidate.owner) {
      notifyUser(candidate.owner, {
        type: "general",
        title: `A candidate moved to ${stage.replace(/_/g, " ")}`,
        message: candidate.name,
        link: "/hr/hiring/candidates",
      });
    }

    return res.status(200).json({ message: `Moved to ${stage.replace(/_/g, " ")}`, item: candidate });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("moveStage error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- the interviews */

/**
 * GET /api/hr/hiring/interviews
 *
 * Every round, across every candidate, as one schedule.
 *
 * Rounds are embedded in the candidate, which is right — a round has no life
 * without the person it is for — but it makes "what is on this week" a
 * question nothing could answer. This flattens them.
 */
export const listInterviews = async (req, res) => {
  try {
    const when = String(req.query.when || "upcoming");
    const outcome = String(req.query.outcome || "").trim();

    const candidates = await Candidate.find({ "interviews.0": { $exists: true } })
      .select("name email position stage interviews jobOpening owner")
      .populate("jobOpening", "title code")
      .populate("owner", "name")
      .sort({ createdAt: -1 });

    const today = new Date(new Date().setHours(0, 0, 0, 0));

    let rounds = candidates.flatMap((candidate) =>
      (candidate.interviews || []).map((round) => ({
        _id: round._id,
        candidateId: candidate._id,
        candidate: candidate.name,
        email: candidate.email,
        position: candidate.position,
        stage: candidate.stage,
        opening: candidate.jobOpening
          ? { _id: candidate.jobOpening._id, title: candidate.jobOpening.title, code: candidate.jobOpening.code }
          : null,
        owner: candidate.owner?.name || "",
        round: round.round,
        mode: round.mode,
        scheduledAt: round.scheduledAt,
        interviewer: round.interviewer,
        interviewerName: round.interviewerName,
        feedback: round.feedback,
        rating: round.rating,
        outcome: round.outcome,
      }))
    );

    if (outcome && outcome !== "all") rounds = rounds.filter((r) => r.outcome === outcome);

    if (when === "upcoming") {
      rounds = rounds
        .filter((r) => r.scheduledAt && new Date(r.scheduledAt) >= today)
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    } else if (when === "past") {
      rounds = rounds
        .filter((r) => r.scheduledAt && new Date(r.scheduledAt) < today)
        .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
    } else if (when === "unscheduled") {
      rounds = rounds.filter((r) => !r.scheduledAt);
    } else {
      rounds.sort((a, b) => new Date(b.scheduledAt || 0) - new Date(a.scheduledAt || 0));
    }

    return res.status(200).json({
      items: rounds,
      total: rounds.length,
      counts: {
        upcoming: candidates.reduce(
          (sum, c) =>
            sum +
            (c.interviews || []).filter((r) => r.scheduledAt && new Date(r.scheduledAt) >= today)
              .length,
          0
        ),
        awaitingFeedback: candidates.reduce(
          (sum, c) =>
            sum +
            (c.interviews || []).filter(
              (r) => r.outcome === "scheduled" && r.scheduledAt && new Date(r.scheduledAt) < today
            ).length,
          0
        ),
      },
    });
  } catch (err) {
    console.error("listInterviews error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ---------------------------------------------------------- the onboarding */

/** GET /api/hr/hiring/onboarding — everybody between selected and employed. */
export const listOnboarding = async (req, res) => {
  try {
    const rows = await Candidate.find({
      $or: [{ stage: { $in: SELECTED_STAGES } }, { "onboarding.startedAt": { $exists: true } }],
    })
      .select(
        "name email phone position department stage offeredSalary onboarding jobOpening hiredUser selectedAt hiredAt"
      )
      .populate("jobOpening", "title code hireAs reportsTo")
      .populate("hiredUser", "name email role")
      .populate("onboarding.reportsTo", "name designation")
      .sort({ selectedAt: -1, createdAt: -1 });

    const shape = (row) => {
      const checklist = row.onboarding?.checklist || [];
      const done = checklist.filter((item) => item.done).length;

      return {
        ...row.toObject(),
        progress: checklist.length ? Math.round((done / checklist.length) * 100) : 0,
        checklistDone: done,
        checklistTotal: checklist.length,
        // Onboarding is complete when there is an account, not when the last
        // box is ticked — see the note on the model
        complete: Boolean(row.hiredUser),
      };
    };

    const items = rows.map(shape);

    return res.status(200).json({
      items,
      total: items.length,
      inProgress: items.filter((row) => !row.complete).length,
      completed: items.filter((row) => row.complete).length,
    });
  } catch (err) {
    console.error("listOnboarding error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * PUT /api/hr/hiring/onboarding/:id
 *
 * The joining details and the checklist. Deliberately cannot set
 * `completedAt` — that belongs to the hire route, which creates the account.
 */
export const updateOnboarding = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });

    const current = candidate.onboarding?.toObject?.() || candidate.onboarding || {};
    const next = { ...current };

    if (!next.startedAt) next.startedAt = new Date();

    ["designation", "department", "notes"].forEach((field) => {
      if (req.body[field] !== undefined) next[field] = String(req.body[field]).trim();
    });
    if (req.body.joiningDate !== undefined) {
      next.joiningDate = req.body.joiningDate || undefined;
    }
    if (req.body.reportsTo !== undefined) {
      next.reportsTo = req.body.reportsTo || undefined;
    }

    /**
     * The checklist arrives as the whole list, so a box ticked by one person
     * while another had the form open does not silently un-tick. Who ticked it
     * and when is stamped here rather than trusted from the client.
     */
    if (Array.isArray(req.body.checklist)) {
      const before = new Map(
        (current.checklist || []).map((item) => [item.label, item])
      );

      next.checklist = req.body.checklist.map((item) => {
        const label = String(item.label || "").trim();
        const was = before.get(label);
        const done = Boolean(item.done);

        return {
          label,
          done,
          doneAt: done ? was?.doneAt || new Date() : undefined,
          doneByName: done ? was?.doneByName || actorOf(req)?.name || "" : "",
        };
      });
    }

    candidate.onboarding = next;
    await candidate.save();

    logActivity(req, {
      action: "updated",
      entity: "Candidate",
      entityId: candidate._id,
      message: `Onboarding updated for ${candidate.name}`,
    });

    return res.status(200).json({ message: "Onboarding updated", item: candidate });
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Candidate not found" });
    console.error("updateOnboarding error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------- the board */

/**
 * GET /api/hr/hiring/dashboard
 *
 * How hiring is going, counted from the records on read. The funnel, the
 * openings and their fill rate, what is scheduled, and where the hires came
 * from — which is the only thing that says whether the recruiting is working.
 */
export const hiringDashboard = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    const today = new Date(new Date().setHours(0, 0, 0, 0));

    const [
      stageRows,
      openingRows,
      liveOpenings,
      hiredThisMonth,
      addedThisMonth,
      sourceRows,
      withInterviews,
      timeToHire,
    ] = await Promise.all([
      Candidate.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }]),
      JobOpening.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      JobOpening.find({ status: { $in: ["open", "on_hold"] } })
        .select("title code department positions status targetDate openedOn")
        .populate("owner", "name")
        .sort({ openedOn: 1 }),
      Candidate.countDocuments({ stage: "hired", hiredAt: { $gte: from, $lte: to } }),
      Candidate.countDocuments({ createdAt: { $gte: from, $lte: to } }),
      Candidate.aggregate([
        {
          $group: {
            _id: "$source",
            total: { $sum: 1 },
            hired: { $sum: { $cond: [{ $eq: ["$stage", "hired"] }, 1, 0] } },
          },
        },
        { $sort: { total: -1 } },
      ]),
      Candidate.find({ "interviews.scheduledAt": { $gte: today } })
        .select("name position interviews jobOpening")
        .populate("jobOpening", "title code")
        .limit(25),
      Candidate.find({ stage: "hired", hiredAt: { $ne: null } }).select("createdAt hiredAt"),
    ]);

    const funnel = {};
    stageRows.forEach((row) => {
      funnel[row._id] = row.count;
    });

    const openingsByStatus = {};
    openingRows.forEach((row) => {
      openingsByStatus[row._id] = row.count;
    });

    /** How many seats each live opening still has, and who is in play for it. */
    const openingIds = liveOpenings.map((o) => o._id);
    const perOpening = await Candidate.aggregate([
      { $match: { jobOpening: { $in: openingIds } } },
      {
        $group: {
          _id: { opening: "$jobOpening", stage: "$stage" },
          count: { $sum: 1 },
        },
      },
    ]);

    const byOpening = {};
    perOpening.forEach((row) => {
      const id = String(row._id.opening);
      byOpening[id] = byOpening[id] || { total: 0, hired: 0, inPlay: 0 };
      byOpening[id].total += row.count;
      if (row._id.stage === "hired") byOpening[id].hired += row.count;
      if (OPEN_STAGES.includes(row._id.stage)) byOpening[id].inPlay += row.count;
    });

    const openings = liveOpenings.map((opening) => {
      const counts = byOpening[String(opening._id)] || { total: 0, hired: 0, inPlay: 0 };
      return {
        _id: opening._id,
        title: opening.title,
        code: opening.code,
        department: opening.department,
        status: opening.status,
        positions: opening.positions || 1,
        targetDate: opening.targetDate,
        openedOn: opening.openedOn,
        owner: opening.owner?.name || "",
        ...counts,
        remaining: Math.max(0, (opening.positions || 1) - counts.hired),
        // Past its target date and still not filled
        overdue: Boolean(
          opening.targetDate &&
            new Date(opening.targetDate) < today &&
            counts.hired < (opening.positions || 1)
        ),
      };
    });

    const upcoming = withInterviews
      .flatMap((candidate) =>
        (candidate.interviews || [])
          .filter((round) => round.scheduledAt && round.scheduledAt >= today)
          .map((round) => ({
            candidateId: candidate._id,
            candidate: candidate.name,
            position: candidate.position,
            opening: candidate.jobOpening?.title || "",
            round: round.round,
            mode: round.mode,
            scheduledAt: round.scheduledAt,
            interviewerName: round.interviewerName,
          }))
      )
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, 8);

    /** Median rather than mean — one candidate who sat on a desk for a year
     *  should not be allowed to describe the other nine. */
    const spans = timeToHire
      .map((c) => Math.round((new Date(c.hiredAt) - new Date(c.createdAt)) / 86400000))
      .filter((days) => days >= 0)
      .sort((a, b) => a - b);
    const medianDays = spans.length
      ? spans.length % 2
        ? spans[(spans.length - 1) / 2]
        : Math.round((spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2)
      : null;

    const seatsOpen = openings.reduce((sum, o) => sum + o.remaining, 0);

    return res.status(200).json({
      period: { year, month },
      funnel,
      inPlay: OPEN_STAGES.reduce((sum, stage) => sum + (funnel[stage] || 0), 0),
      openings,
      openingsByStatus,
      stats: {
        liveOpenings: openings.length,
        seatsOpen,
        overdueOpenings: openings.filter((o) => o.overdue).length,
        hiredThisMonth,
        addedThisMonth,
        medianDaysToHire: medianDays,
        interviewsUpcoming: upcoming.length,
      },
      sources: sourceRows.map((row) => ({
        source: row._id || "other",
        total: row.total,
        hired: row.hired,
        // What proportion of this source's candidates ended up joining
        rate: row.total ? Math.round((row.hired / row.total) * 100) : 0,
      })),
      upcoming,
    });
  } catch (err) {
    console.error("hiringDashboard error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/hr/hiring/lookups
 *
 * The openings and interviewers the hiring forms need, without borrowing an
 * endpoint that also returns clients and projects.
 */
export const hiringLookups = async (req, res) => {
  try {
    const [live, staff] = await Promise.all([
      JobOpening.find({ status: { $in: ["open", "on_hold"] } })
        .select("title code department positions hireAs reportsTo")
        .sort({ title: 1 }),
      User.find({
        role: { $in: ["manager", "operations_manager", "employee", "hr", "hr_manager"] },
        status: "active",
      })
        .select("name designation role")
        .sort({ name: 1 }),
    ]);

    return res.status(200).json({ openings: live, staff });
  } catch (err) {
    console.error("hiringLookups error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
