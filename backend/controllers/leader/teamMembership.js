import User from "../../models/User.js";

import { logActivity } from "../../utils/activity.js";
import { notifyUser } from "../../utils/notify.js";
import {
  departmentMap,
  departmentsOf,
  labelDepartments,
  sameDepartment,
} from "../../utils/departments.js";

/**
 * An operations manager assembling their own team.
 *
 * Until this existed `reportsTo` was set only by an admin, so a leader created
 * on Monday sat in front of an empty Team Members page until somebody else got
 * round to assigning them people — a real stall, because the leader is the one
 * who knows who they need.
 *
 * Every employee is offered, not just the unassigned ones. That was a
 * deliberate change: the first version showed only people who reported to
 * nobody, which in a company where everybody already has a leader means the
 * list is empty and the feature does nothing.
 *
 * So taking somebody from another leader is allowed — but never silently:
 *
 *   the list says who each person currently reports to
 *   the previous leader is told their team has changed
 *   both sides of the move are written to the activity log
 *
 * That is the trade. A reassignment is a normal thing for a leader to do; a
 * reassignment nobody noticed is how somebody finds out on Friday that half
 * their team has gone. The visibility is the safeguard, not a refusal.
 *
 * The one line that is not crossable is the department. A leader may take
 * somebody from a colleague running the same kind of work; they may not reach
 * into another department and take a person out of it. An operations manager
 * assembling a delivery team has no business holding a sales executive's
 * reporting line, and the pickers used to offer exactly that — every employee
 * in the company, with nothing to say which of them were somebody else's
 * discipline entirely.
 *
 * "Same department" is asked of the Team records first and the free-text
 * department second, and an unknown answer on either side is permissive — see
 * utils/departments. Refusing on a blank field would empty the picker in a
 * company that has not finished filling in its teams, which is the failure
 * this list has already been rescued from once.
 *
 * The filter is applied twice on purpose: once so the list does not offer what
 * cannot be taken, and once on the way in, because hiding a row has never been
 * access control.
 *
 * Nothing but `reportsTo` is ever written. This is not a route that can edit a
 * staff record, and it is kept in its own file so that stays obvious.
 */

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/leader/team/available
 *
 * The active employees of this leader's own department, with the leader each
 * of them currently answers to. The name is historical — it is the pool a
 * leader picks from, and inside the department it is deliberately everybody
 * rather than the leftovers.
 */
export const availableMembers = async (req, res) => {
  try {
    const query = { role: "employee", status: "active" };

    const search = (req.query.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ name: regex }, { email: regex }, { designation: regex }];
    }

    const [people, byPerson] = await Promise.all([
      User.find(query)
        .select("name email designation department joiningDate reportsTo")
        .populate("reportsTo", "name")
        .sort({ name: 1 }),
      departmentMap(),
    ]);

    const mine = String(req.leader._id);
    const myDepartments = departmentsOf(req.leader, byPerson);

    const items = people
      .filter((person) => sameDepartment(myDepartments, departmentsOf(person, byPerson)))
      .map((person) => {
        const leaderId = String(person.reportsTo?._id || person.reportsTo || "");

        return {
          _id: person._id,
          name: person.name,
          email: person.email,
          designation: person.designation,
          department: person.department,
          joiningDate: person.joiningDate,
          // Who they answer to today, so choosing one is an informed act rather
          // than an accident
          currentLeader: person.reportsTo ? { _id: leaderId, name: person.reportsTo.name } : null,
          onMyTeam: leaderId === mine,
          // On somebody else's team — the picker warns before taking them
          onAnotherTeam: Boolean(leaderId) && leaderId !== mine,
        };
      });

    return res.status(200).json({
      items,
      total: items.length,
      unassigned: items.filter((p) => !p.currentLeader).length,
      onMyTeam: items.filter((p) => p.onMyTeam).length,
      /**
       * What the list was narrowed to, so the screen can say so rather than
       * leaving a leader wondering where a colleague went. Empty when this
       * account's own department is not recorded anywhere — then nothing was
       * narrowed and there is nothing to explain.
       */
      department: {
        kinds: myDepartments,
        label: labelDepartments(myDepartments),
        // How many of the company's employees are somebody else's discipline
        excluded: people.length - items.length,
      },
    });
  } catch (err) {
    console.error("leader availableMembers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/leader/team/members   { employees: [id] }
 *
 * Take one or more employees onto this team, whoever they reported to before.
 */
export const addMembers = async (req, res) => {
  try {
    const wanted = (
      Array.isArray(req.body.employees) ? req.body.employees : [req.body.employees]
    ).filter(Boolean);

    if (!wanted.length) {
      return res.status(400).json({ message: "Choose at least one person" });
    }

    /**
     * Only employees, and only ever employees. A leader must not be able to
     * make another operations manager, a manager or an administrator report to them
     * — that is not a team change, it is a reorganisation of the company.
     */
    const [people, byPerson] = await Promise.all([
      User.find({ _id: { $in: wanted }, role: "employee" })
        .select("name email department reportsTo")
        .populate("reportsTo", "name"),
      departmentMap(),
    ]);

    if (!people.length) {
      return res.status(400).json({ message: "None of those are employees" });
    }

    /**
     * Checked here and not only in the picker. A filtered list is a courtesy;
     * this is the rule. Somebody posting an id the list never offered — a
     * stale modal, a copied request — gets the same answer a colleague's
     * department would give them in person.
     */
    const myDepartments = departmentsOf(req.leader, byPerson);
    const outside = people.filter(
      (person) => !sameDepartment(myDepartments, departmentsOf(person, byPerson))
    );

    if (outside.length) {
      const label = labelDepartments(myDepartments);
      return res.status(403).json({
        message:
          outside.length === 1
            ? `${outside[0].name} is not in ${label || "your department"} — ask their manager to move them`
            : `${outside.length} of those are not in ${label || "your department"} — ask their managers to move them`,
      });
    }

    const mine = String(req.leader._id);
    const moving = people.filter((person) => String(person.reportsTo?._id || "") !== mine);

    if (!moving.length) {
      return res.status(200).json({
        message: "They are already on your team",
        added: 0,
        skipped: people.length,
      });
    }

    await User.updateMany(
      { _id: { $in: moving.map((person) => person._id) } },
      { $set: { reportsTo: req.leader._id } }
    );

    /**
     * Tell everybody the move affects.
     *
     * The person themselves, obviously — but also the leader who has just lost
     * them. A team that shrinks without its leader being told is the failure
     * this whole notification exists to prevent.
     */
    const lostBy = new Map();

    moving.forEach((person) => {
      notifyUser(person._id, {
        type: "general",
        title: "You have been added to a team",
        message: `${req.leader.name} is now your operations manager`,
        link: "/employee/dashboard",
      });

      const previous = person.reportsTo;
      if (!previous) return;

      const key = String(previous._id);
      lostBy.set(key, [...(lostBy.get(key) || []), person.name]);
    });

    lostBy.forEach((names, leaderId) => {
      notifyUser(leaderId, {
        type: "general",
        title: "Someone left your team",
        message: `${names.join(", ")} now report${names.length === 1 ? "s" : ""} to ${req.leader.name}`,
        link: "/operation-manager/team",
      });
    });

    const taken = moving.filter((person) => person.reportsTo);

    logActivity(req, {
      action: "updated",
      entity: "Team",
      entityId: req.leader._id,
      message:
        `${req.leader.name} added ${moving.map((p) => p.name).join(", ")} to their team` +
        (taken.length
          ? ` (${taken
              .map((p) => `${p.name} was with ${p.reportsTo.name}`)
              .join("; ")})`
          : ""),
    });

    const already = people.length - moving.length;

    return res.status(200).json({
      message:
        `${moving.length} added to your team` +
        (taken.length ? ` — ${taken.length} moved from another team` : "") +
        (already ? `, ${already} already yours` : ""),
      added: moving.length,
      movedFromAnother: taken.length,
      skipped: already,
    });
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "That is not a person" });
    console.error("leader addMembers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * DELETE /api/leader/team/members/:id
 *
 * Let somebody go back to the unassigned pool. Only somebody who already
 * reports to this leader — you can take people onto your own team, but you
 * cannot reach into a colleague's and empty it.
 */
export const removeMember = async (req, res) => {
  try {
    const person = await User.findOne({
      _id: req.params.id,
      role: "employee",
      reportsTo: req.leader._id,
    }).select("name");

    if (!person) {
      return res.status(404).json({ message: "That person is not on your team" });
    }

    /**
     * Their work is deliberately left alone. Tasks already assigned to them
     * stay theirs and the projects they are on keep them — releasing somebody
     * is a change of reporting line, not a reason to strip a month of work off
     * the board.
     */
    await User.updateOne({ _id: person._id }, { $unset: { reportsTo: "" } });

    notifyUser(person._id, {
      type: "general",
      title: "You are no longer on a team",
      message: `${req.leader.name} is no longer your operations manager`,
    });

    logActivity(req, {
      action: "updated",
      entity: "Team",
      entityId: req.leader._id,
      message: `${req.leader.name} removed ${person.name} from their team`,
    });

    return res.status(200).json({ message: `${person.name} is no longer on your team` });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "That person is not on your team" });
    }
    console.error("leader removeMember error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
