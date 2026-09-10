/**
 * Who put somebody on a project, and when.
 *
 * `Project.members` and `CodeProject.employees` are plain id lists — they say
 * that somebody is on a project but nothing about how they got there. The
 * employee looking at their own list has a fair question the app could not
 * answer: which operations manager sent me this, and when?
 *
 * So a parallel list of records answers it. Kept beside the id list rather than
 * replacing it, because every existing query — the employee's scope, the check
 * that lets them submit code, half a dozen aggregations — reads the ids, and
 * none of them should have to change to learn who did the adding.
 *
 * The name is copied in rather than looked up later, the same way senderName
 * on a message and actorName on an activity log are: the record has to stay
 * readable after an account is renamed or removed, and "assigned by (deleted
 * user)" is not an answer.
 */

const idOf = (value) => String(value?._id || value || "");

/** The record written when somebody is put on a project. */
export const assignmentRecord = (userId, actor) => ({
  user: userId,
  assignedBy: actor?._id,
  assignedByName: actor?.name || "",
  assignedByRole: actor?.role || "",
  assignedAt: new Date(),
});

/**
 * Bring the record list in line with the id list.
 *
 * Records for people no longer on the project are dropped, people already on
 * it keep the record they have — being re-saved as part of a wider edit is not
 * a new assignment — and anybody newly added gets a fresh one.
 */
export const syncAssignments = (existing = [], nextIds = [], actor) => {
  const next = new Set(nextIds.map(idOf));
  const kept = (existing || []).filter((row) => next.has(idOf(row.user)));
  const have = new Set(kept.map((row) => idOf(row.user)));

  const added = [...next].filter((id) => !have.has(id));

  return [...kept, ...added.map((id) => assignmentRecord(id, actor))];
};

/** This person's record, if there is one. */
export const assignmentFor = (records = [], userId) =>
  (records || []).find((row) => idOf(row.user) === idOf(userId)) || null;

/**
 * What a panel should show for "who sent me this".
 *
 * Falls back to the operations manager when there is no record — memberships made
 * before this was tracked, or by an admin straight from their own screen. The
 * leader is who is answerable for that person being on the project either way,
 * so the name is useful; the date is not guessed, and comes back null.
 */
export const assignedByFor = (records, userId, fallbackName = "") => {
  const record = assignmentFor(records, userId);

  if (!record) return { assignedBy: fallbackName || "", assignedAt: null, exact: false };

  return {
    assignedBy: record.assignedByName || fallbackName || "",
    assignedByRole: record.assignedByRole || "",
    assignedAt: record.assignedAt || null,
    exact: true,
  };
};
