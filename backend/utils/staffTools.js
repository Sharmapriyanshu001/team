import AdAccount from "../models/AdAccount.js";
import Credential from "../models/Credential.js";
import DeveloperConsole from "../models/DeveloperConsole.js";
import PublishedApp from "../models/PublishedApp.js";
import SeoProject from "../models/SeoProject.js";
import SocialPost from "../models/SocialPost.js";

import { vaultReady } from "./secretBox.js";

/**
 * Which of the specialist tools this person actually has work in.
 *
 * Play Store, SEO & Social, Ads and the Vault are not things an account is
 * granted — they are things an account is *assigned to*, one record at a time,
 * by whoever runs that side of the business. Somebody on the operations floor
 * is assigned none of them and their four menu entries lead to four empty
 * screens, which is worse than no entry at all: an empty screen reads as
 * something broken, and four of them teach people to stop trusting the menu.
 *
 * So the sidebar asks this instead of assuming. The queries below are the same
 * ones the "my work" handlers run — deliberately, because a menu entry that
 * disagrees with the page behind it is the one bug this cannot be allowed to
 * have. If mySeoWork would return an engagement, SEO is in the menu; if it
 * would return nothing, it is not.
 *
 * This is a menu, not a gate. Nothing here decides what anybody may read — the
 * handlers already scope every row to the person asking, and hiding a row has
 * never been access control. It decides only what is worth showing.
 */
export const toolsFor = async (user, { leader = false } = {}) => {
  const id = user._id;

  /**
   * A manager reaches what their team was given as well as what they were,
   * which is the same $or the ads and SEO handlers use.
   */
  const assigned = leader
    ? { $or: [{ operationsManagers: id }, { employees: id }] }
    : { employees: id };

  const consoleQuery = leader
    ? { operationsManagers: id }
    : { $or: [{ employees: id }, { operationsManagers: id }] };

  const [seoProject, socialPost, adAccount, console_, app, credential] = await Promise.all([
    SeoProject.exists(assigned),
    SocialPost.exists({ assignedTo: id }),
    AdAccount.exists(assigned),
    DeveloperConsole.exists(consoleQuery),
    PublishedApp.exists({ employees: id }),
    // A vault with no key configured has nothing to show anybody
    vaultReady() ? Credential.exists({ sharedWith: id, status: { $ne: "retired" } }) : null,
  ]);

  return {
    play: Boolean(console_ || app),
    seo: Boolean(seoProject || socialPost),
    ads: Boolean(adAccount),
    vault: Boolean(credential),
  };
};

/**
 * The same answer, but never an error.
 *
 * This is read on the way into the panel, beside the profile. A tool menu is
 * not worth failing a sign-in over, so a database hiccup here costs four menu
 * entries rather than the session.
 */
export const safeToolsFor = async (user, options) => {
  try {
    return await toolsFor(user, options);
  } catch (err) {
    console.error("toolsFor error:", err.message);
    return { play: false, seo: false, ads: false, vault: false };
  }
};
