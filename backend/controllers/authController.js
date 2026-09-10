import ActivityLog from "../models/ActivityLog.js";
import Client from "../models/Client.js";
import User from "../models/User.js";

import { comparePassword } from "../utils/password.js";
import { CLIENT_PANEL, panelForRole, panelSession } from "../utils/panels.js";
import { signClientToken, signStaffToken } from "../utils/token.js";

/**
 * One door for everybody.
 *
 * Six panels each had their own login page and their own endpoint, which meant
 * a person had to know which of six URLs was theirs before they could type a
 * password — and getting it wrong told them their perfectly good credentials
 * were refused. This asks once, works out which panel the account belongs to,
 * and says where to go.
 *
 * WHAT THIS IS NOT
 *
 * It is not a new kind of session. Every staff panel already minted the
 * IDENTICAL token — utils/token.js signs {id, email, role, tv} for all of
 * them, and the isolation between panels has always lived in the middleware,
 * which checks the role against its own list. So this endpoint mints the same
 * token those endpoints did and changes nothing about what it unlocks: an
 * employee's token is still refused by adminAuth, exactly as before.
 *
 * The per-panel logins are deliberately left mounted. They are what the
 * existing tests, the seed scripts and any bookmarked deep link use, and
 * removing them would be a breaking change to buy nothing — the browser simply
 * stops sending people to them.
 *
 * WHY IT DOES NOT SAY WHICH HALF WAS WRONG
 *
 * Every refusal below returns the same sentence. An endpoint that answers
 * "no such account" for one email and "wrong password" for another is an
 * endpoint that will happily tell somebody which of the company's email
 * addresses are real, one guess at a time. The rate limiters on the route are
 * the other half of that.
 */

const REFUSED = "Invalid email or password";

/**
 * POST /api/auth/login
 */
export const login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Enter your email and password" });
    }

    /**
     * Staff first, then clients.
     *
     * The two live in different collections and a client carries no role, so
     * they cannot be looked up together. Staff is checked first because it is
     * the larger set; an address that somehow exists in both would sign in as
     * staff, which is the safer of the two to be wrong about — the client
     * portal shows one client's projects, and the staff panels are scoped by
     * role either way.
     */
    const user = await User.findOne({ email });

    if (user) {
      if (!comparePassword(password, user.password)) {
        return res.status(401).json({ message: REFUSED });
      }
      if (user.status !== "active") {
        return res.status(403).json({
          message: "This account is inactive. Ask your administrator to switch it back on.",
        });
      }

      const panel = panelForRole(user.role);

      /**
       * A real account with a role no panel accepts — "user" is the default on
       * the schema and belongs to nobody's panel. Told plainly rather than
       * refused as a bad password, because the password was right and the
       * person needs to know the problem is their account, not their typing.
       */
      if (!panel) {
        return res.status(403).json({
          message:
            "This account has no panel assigned yet. Ask your administrator to set your role.",
        });
      }

      ActivityLog.create({
        actor: user._id,
        actorName: user.name,
        action: "login",
        entity: panel.label,
        entityId: user._id,
        message: `${user.name} signed in to the ${panel.label} panel`,
      }).catch((err) => console.error("login log error:", err.message));

      return res.status(200).json({
        message: "Signed in",
        token: signStaffToken(user),
        ...panelSession(panel),
        user: {
          _id: user._id,
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          designation: user.designation || "",
          department: user.department || "",
        },
      });
    }

    /* ------------------------------------------------------------ clients */

    const client = await Client.findOne({ email });

    if (!client || !client.password || !comparePassword(password, client.password)) {
      return res.status(401).json({ message: REFUSED });
    }
    if (client.status === "inactive") {
      return res.status(403).json({ message: "This portal account is switched off." });
    }

    ActivityLog.create({
      actorName: client.name,
      action: "login",
      entity: "Client",
      entityId: client._id,
      message: `${client.name} signed in to the client portal`,
    }).catch((err) => console.error("login log error:", err.message));

    /** Last seen, the same field the client panel's own login writes. */
    Client.updateOne({ _id: client._id }, { $set: { lastLogin: new Date() } }).catch(() => {});

    return res.status(200).json({
      message: "Signed in",
      token: signClientToken(client),
      ...panelSession(CLIENT_PANEL),
      user: {
        _id: client._id,
        id: client._id,
        name: client.name,
        email: client.email,
        company: client.company || "",
        role: "client",
      },
    });
  } catch (err) {
    console.error("unified login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
