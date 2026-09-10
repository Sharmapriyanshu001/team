import { useEffect, useState } from "react";

import salesApi from "../salesApi";

/**
 * What this sales account may do, as the server sees it.
 *
 * Used to leave out the screens an executive cannot reach. That is
 * presentation only — every route checks again, and the row-level scoping
 * that actually matters happens in the queries, so a hand-typed URL gets the
 * same answer a hidden link would have.
 */

// One request per page load, shared by every component that asks
let pending = null;
let cached = null;
/**
 * The account itself, kept beside its permissions.
 *
 * /sales/me already answers with both, and it is already fetched once per page
 * load — so a screen that wants to say "Field Sales · 6 people" can have it
 * without a second request. Cached and cleared together with the permissions,
 * because they go stale for the same reasons.
 */
let cachedAccount = null;

const OPEN = { isSalesHead: false, modules: {}, scope: "own" };

const load = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = salesApi
      .get("/sales/me")
      .then(({ data }) => {
        cached = data.permissions || OPEN;
        cachedAccount = data.sales || null;
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
export const forgetSalesAccess = () => {
  cached = null;
  cachedAccount = null;
  pending = null;
};

export default function useSalesAccess() {
  const [access, setAccess] = useState(cached);
  const [account, setAccount] = useState(cachedAccount);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (!active) return;
      setAccess(value);
      setAccount(cachedAccount);
    });
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
    account,
    loading: !access,
    isSalesHead: Boolean(access?.isSalesHead),
    scope: access?.scope || "own",
    can,
  };
}
