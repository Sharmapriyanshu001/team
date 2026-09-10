import { useEffect, useState } from "react";
import hrApi from "../hrApi";

/**
 * What this HR account may do, as the server sees it.
 *
 * Used to leave out the one screen an HR Manager cannot reach. That is
 * presentation only — /api/hr/managers refuses them either way, so a
 * hand-typed URL gets the same answer a hidden link would have.
 */

// One request per page load, shared by every component that asks
let pending = null;
let cached = null;

const OPEN = { isHrAdmin: false, modules: {} };

const load = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = hrApi
      .get("/hr/me")
      .then(({ data }) => {
        cached = data.access || OPEN;
        return cached;
      })
      .catch(() => {
        // If we cannot ask, assume the narrower of the two roles. Offering a
        // door that will not open is worse than leaving one out.
        cached = OPEN;
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
};

/** Clears the cache — for when this account's own role has just changed. */
export const forgetHrAccess = () => {
  cached = null;
  pending = null;
};

export default function useHrAccess() {
  const [access, setAccess] = useState(cached);

  useEffect(() => {
    let active = true;
    load().then((value) => active && setAccess(value));
    return () => {
      active = false;
    };
  }, []);

  const can = (module, action = "view") => {
    if (!access) return false;
    return (access.modules?.[module] || []).includes(action);
  };

  return {
    access,
    loading: !access,
    isHrAdmin: Boolean(access?.isHrAdmin),
    can,
  };
}
