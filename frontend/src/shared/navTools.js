import { KeyRound, Megaphone, Search, Store } from "lucide-react";

/**
 * The four specialist screens, for whoever actually has work in them.
 *
 * Play Store, SEO & Social, Ads and the Vault are not permissions somebody is
 * granted. Each is a list of records — an ad account, an SEO engagement, a
 * developer console, a shared credential — that somebody was put on one at a
 * time by whoever runs that side of the business. An employee on the
 * operations floor is put on none of them, and four menu entries leading to
 * four empty screens is worse than no entries at all: an empty screen reads as
 * something failing to load, and four of them teach people to stop trusting
 * the menu.
 *
 * So the panels ask. `tools` comes back from /me, built by the server from the
 * same queries the screens themselves run (see backend/utils/staffTools.js),
 * which is what stops a menu entry and the page behind it from disagreeing.
 *
 * This is a menu, not a gate. Nothing hidden here is protected by being
 * hidden — every one of those handlers already scopes its rows to the person
 * asking, and hiding a row has never been access control.
 *
 * `section` is the heading to put above them, or null for a panel with a flat
 * sidebar. Either way, nothing is emitted when there is nothing to show — a
 * heading over an empty list is still clutter.
 */
export const toolItems = (tools = {}, base, { section = "Tools" } = {}) => {
  const items = [
    tools.play && { label: "Play Store", to: `${base}/play`, icon: Store },
    tools.seo && { label: "SEO & Social", to: `${base}/seo`, icon: Search },
    tools.ads && { label: "Ads", to: `${base}/ads`, icon: Megaphone },
    tools.vault && { label: "Vault", to: `${base}/vault`, icon: KeyRound },
  ].filter(Boolean);

  if (!items.length) return [];
  return section ? [{ section }, ...items] : items;
};
