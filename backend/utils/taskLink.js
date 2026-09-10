import { HR_PANEL_ROLES, SALES_PANEL_ROLES } from "../models/User.js";

/**
 * Where to send somebody who has just been given work.
 *
 * Each role signs in to a different panel, so "your tasks" is a different URL
 * for each of them, and a notification that points at the wrong one lands the
 * reader on a login screen for an account they do not have. The rule was
 * written out by hand in three places and only knew about two roles; now that
 * a department manager can hand work to their whole department, it has to
 * know about the rest.
 *
 * Sales and HR have no task screen of their own yet — the panels are built,
 * the list is not. Rather than point at a page that does not exist, they get
 * their own notifications page, where the message itself is readable and says
 * what the work is. That is a stop-gap, and the moment either panel grows a
 * task list this is the one line to change.
 */
export const taskLinkFor = (role) => {
  if (role === "operations_manager" || role === "manager") return "/operation-manager/tasks/pending";
  if (SALES_PANEL_ROLES.includes(role)) return "/sales/notifications";
  if (HR_PANEL_ROLES.includes(role)) return "/hr/notifications";
  return "/employee/tasks/pending";
};

export default taskLinkFor;
