import { useEffect, useState } from "react";
import adminApi from "../adminApi";

/**
 * What the signed-in admin may do, as the server sees it.
 *
 * Used to leave out sidebar sections this account cannot reach. That is
 * presentation only — every route checks again, so a hand-typed URL gets the
 * same refusal a hidden link would have. Hiding a button has never been access
 * control and is not being asked to be here.
 */

// One request per page load, shared by every component that asks.
let pending = null;
let cached = null;

const OPEN = { isSuperAdmin: false, unrestricted: true, modules: {}, roleName: "", problem: "" };

const load = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = adminApi
      .get("/admin/me")
      .then(({ data }) => {
        cached = data.permissions || OPEN;
        return cached;
      })
      .catch(() => {
        // If we cannot ask, show everything and let each route refuse. The
        // alternative — hiding the whole panel on a hiccup — is worse.
        cached = OPEN;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
};

/** Clears the cache, for when an admin's own role has just been changed. */
export const forgetPermissions = () => {
  cached = null;
  pending = null;
};

export default function usePermissions() {
  const [permissions, setPermissions] = useState(cached);

  useEffect(() => {
    let active = true;
    load().then((value) => active && setPermissions(value));
    return () => {
      active = false;
    };
  }, []);

  const can = (module, action = "view") => {
    if (!permissions) return true; // still loading — do not flash things away
    if (permissions.unrestricted) return true;
    if (permissions.problem) return false;
    return (permissions.modules?.[module] || []).includes(action);
  };

  return {
    permissions,
    loading: !permissions,
    isSuperAdmin: Boolean(permissions?.isSuperAdmin),
    roleName: permissions?.roleName || "",
    problem: permissions?.problem || "",
    can,
  };
}
