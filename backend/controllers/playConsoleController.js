import DeveloperConsole from "../models/DeveloperConsole.js";
import PublishedApp from "../models/PublishedApp.js";
import AppRelease from "../models/AppRelease.js";
import PolicyAlert from "../models/PolicyAlert.js";

import { buildCrud, InvalidInput } from "../utils/crud.js";
import { logActivity } from "../utils/activity.js";
import { notifyUsers } from "../utils/notify.js";

/**
 * Google Play: the consoles, the apps on them, what has been shipped, and what
 * Google is unhappy about.
 *
 * ── a note on the field named `console` ──────────────────────────────────
 * PublishedApp.console and PolicyAlert.console are the domain word and read
 * correctly everywhere they are used as `app.console`. They must never be
 * pulled out with destructuring — `const { console } = req.body` shadows the
 * global in that scope and turns the next console.error into a TypeError.
 * Read them as `req.body.console` instead. Every place below does.
 */

/* ------------------------------------------------------------------ helpers */

const asIdList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => (entry && entry._id) || entry)
    .filter(Boolean)
    .map(String);

/**
 * Turn a list of user ids into the assignment rows that say who did the
 * adding. Rows for people already on the record are kept as they are, so
 * re-saving a form does not rewrite everybody's assignedAt to today.
 */
const mergeAssignments = (existingRows = [], userIds = [], actor) => {
  const byUser = new Map(existingRows.map((row) => [String(row.user), row]));

  return userIds.map(
    (id) =>
      byUser.get(String(id)) || {
        user: id,
        assignedBy: actor?._id,
        assignedByName: actor?.name || "",
        assignedByRole: actor?.role || "admin",
        assignedAt: new Date(),
      }
  );
};

/** Who is newly on the list, so only they are told about it. */
const newcomers = (before = [], after = []) => {
  const had = new Set(before.map(String));
  return after.map(String).filter((id) => !had.has(id));
};

/* ----------------------------------------------------------------- consoles */

export const consoles = buildCrud(DeveloperConsole, {
  entity: "Developer console",
  searchFields: ["name", "accountEmail", "developerId"],
  filterFields: ["status", "ownership", "client"],
  populate: [
    { path: "client", select: "name company" },
    { path: "operationsManagers", select: "name email" },
    { path: "employees", select: "name email" },
  ],
  sort: { createdAt: -1 },

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    /**
     * A console owned by the studio has no client, and one owned by a client
     * has to say which. Left alone, a form that switches ownership from client
     * to studio would keep pointing at whoever it used to belong to.
     */
    const ownership = data.ownership || existing?.ownership || "studio";
    if (ownership === "client") {
      if (!data.client && !existing?.client) {
        throw new InvalidInput("Pick the client this console belongs to");
      }
    } else {
      data.client = null;
    }

    if (data.operationsManagers !== undefined || data.employees !== undefined) {
      const leaders = asIdList(data.operationsManagers ?? existing?.operationsManagers);
      const staff = asIdList(data.employees ?? existing?.employees);
      data.operationsManagers = leaders;
      data.employees = staff;
      data.assignments = mergeAssignments(
        existing?.assignments,
        [...leaders, ...staff],
        req.admin
      );
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    const before = [...(previous?.operationsManagers || []), ...(previous?.employees || [])];
    const after = [...(doc.operationsManagers || []), ...(doc.employees || [])];
    const told = isNew ? after : newcomers(before, after);

    notifyUsers(told, {
      type: "assignment",
      title: "You were given access to a Play console",
      message: `${doc.name} — you can now see its apps and releases.`,
      link: "/play/consoles",
    });
  },
});

/**
 * Deleting a console that still carries apps is refused rather than cascaded.
 *
 * The apps are the valuable records — release history, rejection reasons, the
 * listing somebody wrote — and a console is deleted by mistake far more often
 * than a studio genuinely walks away from a developer account. Moving the apps
 * somewhere first is a deliberate act; losing them to a stray click is not.
 */
export const removeConsole = async (req, res) => {
  try {
    const target = await DeveloperConsole.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "Developer console not found" });

    const appCount = await PublishedApp.countDocuments({ console: target._id });
    if (appCount) {
      return res.status(409).json({
        message: `This console still has ${appCount} app${
          appCount === 1 ? "" : "s"
        } on it. Move or delete those first.`,
      });
    }

    await PolicyAlert.deleteMany({ console: target._id });
    await target.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "Developer console",
      entityId: target._id,
      message: `Developer console "${target.name}" deleted`,
    });

    return res.status(200).json({ message: "Developer console deleted" });
  } catch (err) {
    console.error("removeConsole error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------------------------------- apps */

export const apps = buildCrud(PublishedApp, {
  entity: "App",
  searchFields: ["name", "packageName"],
  filterFields: ["status", "console", "client"],
  populate: [
    { path: "console", select: "name accountEmail status" },
    { path: "client", select: "name company" },
    { path: "employees", select: "name email" },
  ],
  sort: { createdAt: -1 },

  beforeSave: async (payload, req, existing) => {
    const data = { ...payload };

    if (data.packageName !== undefined) {
      const pkg = String(data.packageName || "").trim().toLowerCase();
      /**
       * Checked here rather than left to the unique index so the message can
       * name the problem. Play's own rule is at least two segments and no
       * leading digit per segment; getting this wrong is only discovered at
       * upload time otherwise.
       */
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) {
        throw new InvalidInput(
          "That is not a valid package name — it should look like com.company.app"
        );
      }
      /**
       * Checked explicitly as well as by the unique index. The index is what
       * actually guarantees it, but its error can only say that something
       * clashed — and "com.acme.app is already on Studio Main" is the sentence
       * that saves somebody opening four consoles to find out where.
       */
      const clash = await PublishedApp.findOne({
        packageName: pkg,
        ...(existing ? { _id: { $ne: existing._id } } : {}),
      })
        .select("name console")
        .populate("console", "name");

      if (clash) {
        throw new InvalidInput(
          `${pkg} is already recorded as "${clash.name}"${
            clash.console?.name ? ` on ${clash.console.name}` : ""
          }`
        );
      }

      data.packageName = pkg;
    }

    const consoleId = data.console || existing?.console;
    if (!consoleId) throw new InvalidInput("Pick the console this app sits on");

    if (data.console && String(data.console) !== String(existing?.console || "")) {
      const target = await DeveloperConsole.findById(data.console).select("_id");
      if (!target) throw new InvalidInput("That console no longer exists");
    }

    if (data.employees !== undefined) {
      const staff = asIdList(data.employees);
      data.employees = staff;
      data.assignments = mergeAssignments(existing?.assignments, staff, req.admin);
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    const told = isNew ? doc.employees || [] : newcomers(previous?.employees, doc.employees);

    notifyUsers(told, {
      type: "assignment",
      title: "You were assigned to an app",
      message: `${doc.name} (${doc.packageName})`,
      link: `/play/apps/${doc._id}`,
    });
  },
});

/**
 * An app's releases and alerts have no meaning without it, so they go with it.
 * That is the opposite of the console rule above, and deliberately so: nobody
 * keeps a rejection reason for an app that no longer exists.
 */
export const removeApp = async (req, res) => {
  try {
    const target = await PublishedApp.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "App not found" });

    const [releases, alerts] = await Promise.all([
      AppRelease.deleteMany({ app: target._id }),
      PolicyAlert.deleteMany({ app: target._id }),
    ]);
    await target.deleteOne();

    logActivity(req, {
      action: "deleted",
      entity: "App",
      entityId: target._id,
      message: `App "${target.name}" deleted with ${releases.deletedCount} releases and ${alerts.deletedCount} alerts`,
    });

    return res.status(200).json({ message: "App deleted" });
  } catch (err) {
    console.error("removeApp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Everything one app screen needs, in one request. */
export const appDetail = async (req, res) => {
  try {
    const app = await PublishedApp.findById(req.params.id)
      .populate("console", "name accountEmail status ownership")
      .populate("client", "name company email")
      .populate("project", "name status")
      .populate("employees", "name email designation");

    if (!app) return res.status(404).json({ message: "App not found" });

    const [releases, alerts] = await Promise.all([
      AppRelease.find({ app: app._id }).sort({ versionCode: -1 }).limit(50),
      PolicyAlert.find({ app: app._id }).sort({ status: 1, deadline: 1 }).populate("owner", "name"),
    ]);

    return res.status(200).json({ item: app, releases, alerts });
  } catch (err) {
    console.error("appDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ----------------------------------------------------------------- releases */

export const listReleases = async (req, res) => {
  try {
    const releases = await AppRelease.find({ app: req.params.id }).sort({ versionCode: -1 });
    return res.status(200).json({ items: releases });
  } catch (err) {
    console.error("listReleases error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Keep the app's cached "what is live" in step with its releases.
 *
 * Recomputed from the releases rather than patched in place, because a release
 * can be edited or deleted after the fact and a patched cache would then be
 * wrong with no way to notice. Reading one indexed document is cheap enough
 * that being certain is the better trade.
 */
const refreshLiveVersion = async (appId) => {
  const live = await AppRelease.findOne({
    app: appId,
    track: "production",
    status: "live",
  }).sort({ versionCode: -1 });

  await PublishedApp.updateOne(
    { _id: appId },
    live
      ? {
          liveVersionName: live.versionName,
          liveVersionCode: live.versionCode,
          lastReleaseAt: live.liveAt || live.updatedAt,
        }
      : { liveVersionName: "", liveVersionCode: 0, lastReleaseAt: null }
  );
};

/** Timestamps that follow from a status, so nobody has to set them by hand. */
const stampStatus = (release, status) => {
  if (status === "submitted" && !release.submittedAt) release.submittedAt = new Date();
  if (status === "live" && !release.liveAt) release.liveAt = new Date();
  if (status === "rejected") release.rejectedAt = new Date();
};

export const createRelease = async (req, res) => {
  try {
    const app = await PublishedApp.findById(req.params.id);
    if (!app) return res.status(404).json({ message: "App not found" });

    const { versionName, versionCode, track, rolloutPercent, status, releaseNotes } = req.body;

    if (!versionName || versionCode === undefined || versionCode === "") {
      return res.status(400).json({ message: "Version name and version code are both required" });
    }

    const code = Number(versionCode);
    if (!Number.isInteger(code) || code < 1) {
      return res.status(400).json({ message: "Version code must be a whole number above zero" });
    }

    /**
     * Play refuses an upload whose version code is not higher than every code
     * the app has ever had — including ones long since replaced. Caught here so
     * the message can name the code it clashed with, which is the only thing
     * that makes the error actionable.
     */
    const highest = await AppRelease.findOne({ app: app._id }).sort({ versionCode: -1 });
    if (highest && code <= highest.versionCode) {
      return res.status(400).json({
        message: `Version code ${code} is not above ${highest.versionCode}, which this app has already used. Play will refuse it.`,
      });
    }

    const release = await AppRelease.create({
      app: app._id,
      versionName: String(versionName).trim(),
      versionCode: code,
      track: track || "production",
      rolloutPercent: rolloutPercent === undefined ? 100 : Number(rolloutPercent),
      status: status || "draft",
      releaseNotes: releaseNotes || "",
      createdBy: req.admin?._id,
      createdByName: req.admin?.name || "",
    });

    stampStatus(release, release.status);
    await release.save();
    await refreshLiveVersion(app._id);

    logActivity(req, {
      action: "created",
      entity: "App release",
      entityId: release._id,
      message: `${app.name} ${release.versionName} (${release.versionCode}) added to ${release.track}`,
    });

    notifyUsers(app.employees, {
      type: "update",
      title: `${app.name} — new release`,
      message: `${release.versionName} (${release.versionCode}) on ${release.track}`,
      link: `/play/apps/${app._id}`,
    });

    return res.status(201).json({ message: "Release added", item: release });
  } catch (err) {
    console.error("createRelease error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateRelease = async (req, res) => {
  try {
    const release = await AppRelease.findById(req.params.releaseId);
    if (!release) return res.status(404).json({ message: "Release not found" });

    const { status, rolloutPercent, releaseNotes, rejectionReason, track } = req.body;

    if (status !== undefined) {
      release.status = status;
      stampStatus(release, status);
    }
    if (track !== undefined) release.track = track;
    if (rolloutPercent !== undefined) release.rolloutPercent = Number(rolloutPercent);
    if (releaseNotes !== undefined) release.releaseNotes = releaseNotes;
    if (rejectionReason !== undefined) release.rejectionReason = rejectionReason;

    /**
     * A rejection with no reason recorded is the same as no record at all —
     * the next person hits the identical policy and learns nothing from this.
     */
    if (release.status === "rejected" && !release.rejectionReason.trim()) {
      return res
        .status(400)
        .json({ message: "Write down why Google rejected it — that is the point of the record" });
    }

    await release.save();
    await refreshLiveVersion(release.app);

    const app = await PublishedApp.findById(release.app).select("name employees");

    logActivity(req, {
      action: "updated",
      entity: "App release",
      entityId: release._id,
      message: `${app?.name || "App"} ${release.versionName} is now ${release.status}`,
    });

    if (["live", "rejected"].includes(release.status) && app) {
      notifyUsers(app.employees, {
        type: release.status === "rejected" ? "alert" : "update",
        title: `${app.name} ${release.versionName} — ${release.status}`,
        message: release.status === "rejected" ? release.rejectionReason : "Now live on Play",
        link: `/play/apps/${app._id}`,
      });
    }

    return res.status(200).json({ message: "Release updated", item: release });
  } catch (err) {
    console.error("updateRelease error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(err.errors)[0].message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeRelease = async (req, res) => {
  try {
    const release = await AppRelease.findById(req.params.releaseId);
    if (!release) return res.status(404).json({ message: "Release not found" });

    const appId = release.app;
    await release.deleteOne();
    await refreshLiveVersion(appId);

    logActivity(req, {
      action: "deleted",
      entity: "App release",
      entityId: release._id,
      message: `Release ${release.versionName} (${release.versionCode}) deleted`,
    });

    return res.status(200).json({ message: "Release deleted" });
  } catch (err) {
    console.error("removeRelease error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ------------------------------------------------------------ policy alerts */

export const alerts = buildCrud(PolicyAlert, {
  entity: "Policy alert",
  searchFields: ["title", "policyName", "detail"],
  filterFields: ["status", "type", "severity", "console", "app"],
  populate: [
    { path: "console", select: "name accountEmail" },
    { path: "app", select: "name packageName" },
    { path: "owner", select: "name email" },
  ],
  // Open ones first, then by how soon they bite
  sort: { status: 1, deadline: 1, createdAt: -1 },
  label: (doc) => doc?.title || "",

  beforeSave: (payload, req, existing) => {
    const data = { ...payload };

    if (!data.console && !data.app && !existing?.console && !existing?.app) {
      throw new InvalidInput("Say which console or app this notice is about");
    }

    /**
     * Resolving is a status change, so the who and when follow from it rather
     * than being separate fields somebody has to remember to fill in.
     */
    if (data.status === "resolved" && existing?.status !== "resolved") {
      data.resolvedAt = new Date();
      data.resolvedBy = req.admin?._id;
    }
    if (data.status && data.status !== "resolved") {
      data.resolvedAt = null;
      data.resolvedBy = null;
    }

    if (!existing) data.createdBy = req.admin?._id;

    return data;
  },

  afterSave: (doc, req, { isNew, previous }) => {
    if (!doc.owner) return;
    if (!isNew && String(previous?.owner || "") === String(doc.owner)) return;

    notifyUsers([doc.owner], {
      type: "alert",
      title: `Play policy: ${doc.title}`,
      message: doc.deadline
        ? `Due ${new Date(doc.deadline).toLocaleDateString("en-IN")}`
        : "No deadline given",
      link: "/play/alerts",
    });
  },
});

/* ----------------------------------------------------------------- overview */

/**
 * The numbers the Play section leads with.
 *
 * Counts rather than documents: this runs on every visit to the section, and
 * none of these questions need a single record's contents to be answered.
 */
export const playOverview = async (req, res) => {
  try {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const [
      consoleCount,
      suspendedConsoles,
      appCount,
      liveApps,
      rejectedApps,
      openAlerts,
      urgentAlerts,
      inReview,
      recentReleases,
      unownedAlerts,
    ] = await Promise.all([
      DeveloperConsole.countDocuments({}),
      DeveloperConsole.countDocuments({ status: { $in: ["suspended", "terminated"] } }),
      PublishedApp.countDocuments({}),
      PublishedApp.countDocuments({ status: "live" }),
      PublishedApp.countDocuments({ status: { $in: ["rejected", "suspended"] } }),
      PolicyAlert.countDocuments({ status: { $in: ["open", "in_progress"] } }),
      PolicyAlert.countDocuments({
        status: { $in: ["open", "in_progress"] },
        deadline: { $lte: soon },
      }),
      AppRelease.countDocuments({ status: { $in: ["submitted", "in_review"] } }),
      AppRelease.find({}).sort({ createdAt: -1 }).limit(8).populate("app", "name packageName"),
      PolicyAlert.countDocuments({ status: { $in: ["open", "in_progress"] }, owner: null }),
    ]);

    return res.status(200).json({
      consoles: { total: consoleCount, suspended: suspendedConsoles },
      apps: { total: appCount, live: liveApps, trouble: rejectedApps },
      alerts: { open: openAlerts, dueSoon: urgentAlerts, unassigned: unownedAlerts },
      releases: { awaitingReview: inReview, recent: recentReleases },
    });
  } catch (err) {
    console.error("playOverview error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* --------------------------------------------- what a staff member may see */

/**
 * The consoles and apps one team member has been put on.
 *
 * Operations Managers and employees never get the whole list. A leader sees consoles
 * they lead plus every app on them; an employee sees only what they were named
 * on directly. Both are answered from the id arrays, which are indexed.
 */
export const myPlayWork = async (req, res) => {
  try {
    const user = req.leader || req.employee;
    const isLeader = Boolean(req.leader);

    const consoleQuery = isLeader
      ? { operationsManagers: user._id }
      : { $or: [{ employees: user._id }, { operationsManagers: user._id }] };

    const myConsoles = await DeveloperConsole.find(consoleQuery)
      .select("name accountEmail status ownership appLimit")
      .populate("client", "name company")
      .sort({ name: 1 });

    const appQuery = isLeader
      ? { $or: [{ console: { $in: myConsoles.map((c) => c._id) } }, { employees: user._id }] }
      : { employees: user._id };

    const myApps = await PublishedApp.find(appQuery)
      .select("name packageName status console client liveVersionName lastReleaseAt")
      .populate("console", "name")
      .populate("client", "name company")
      .sort({ updatedAt: -1 });

    const openAlerts = await PolicyAlert.find({
      status: { $in: ["open", "in_progress"] },
      $or: [
        { console: { $in: myConsoles.map((c) => c._id) } },
        { app: { $in: myApps.map((a) => a._id) } },
        { owner: user._id },
      ],
    })
      .sort({ deadline: 1 })
      .limit(25)
      .populate("app", "name")
      .populate("console", "name");

    return res.status(200).json({ consoles: myConsoles, apps: myApps, alerts: openAlerts });
  } catch (err) {
    console.error("myPlayWork error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Staff need the same one-app view the admin has, for apps they are on. */
export const myAppDetail = async (req, res) => {
  try {
    const user = req.leader || req.employee;

    const app = await PublishedApp.findById(req.params.id)
      .populate("console", "name accountEmail status operationsManagers")
      .populate("client", "name company")
      .populate("employees", "name email designation");

    if (!app) return res.status(404).json({ message: "App not found" });

    const onApp = (app.employees || []).some((e) => String(e._id) === String(user._id));
    const leadsConsole = (app.console?.operationsManagers || []).some(
      (id) => String(id) === String(user._id)
    );

    if (!onApp && !leadsConsole) {
      return res.status(403).json({ message: "You are not assigned to this app" });
    }

    const [releases, appAlerts] = await Promise.all([
      AppRelease.find({ app: app._id }).sort({ versionCode: -1 }).limit(50),
      PolicyAlert.find({ app: app._id }).sort({ status: 1, deadline: 1 }),
    ]);

    return res.status(200).json({ item: app, releases, alerts: appAlerts });
  } catch (err) {
    console.error("myAppDetail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Staff record releases too — that is the work. Reuses the admin path's rules. */
export const staffCreateRelease = async (req, res) => {
  const user = req.leader || req.employee;
  const app = await PublishedApp.findById(req.params.id).select("employees console");

  if (!app) return res.status(404).json({ message: "App not found" });

  const onApp = (app.employees || []).some((id) => String(id) === String(user._id));
  if (!onApp) {
    const owning = await DeveloperConsole.findOne({
      _id: app.console,
      operationsManagers: user._id,
    }).select("_id");
    if (!owning) return res.status(403).json({ message: "You are not assigned to this app" });
  }

  // createRelease reads req.admin for authorship; staff arrive under their own key
  req.admin = user;
  return createRelease(req, res);
};
