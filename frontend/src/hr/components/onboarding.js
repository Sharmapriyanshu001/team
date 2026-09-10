/**
 * What the onboarding pack asks for, and what makes it complete.
 *
 * Kept beside OnboardingFields rather than inside it because a form and the
 * rules a form is judged by are two different things: the caller needs the
 * blank shape to start from and the check to run before it saves, and neither
 * of those should mean importing a screenful of JSX.
 */

/** What a form starts with, and what it is reset to. */
export const BLANK_PAPERWORK = {
  documents: { aadhaarNumber: "", panNumber: "" },
  bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "" },
};

const AADHAAR = /^\d{12}$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;

const digits = (value) => String(value || "").replace(/[\s-]/g, "");
const clean = (value) => String(value || "").trim().toUpperCase();

/**
 * What the paperwork step will not be finished without.
 *
 * The numbers are checked for shape as well as for presence, because a
 * mistyped Aadhaar is the same problem as a missing one two months later when
 * somebody needs it — and the server stores what it is given rather than
 * guessing.
 *
 * The four scans are deliberately not in here. A person starts on Monday and
 * the photograph of their PAN card turns up on Thursday; refusing to open
 * their account until then is what stopped people being added at all. The
 * slots are on the form, and can be filled from the person's own record later.
 */
export const paperworkProblems = (form) => {
  const problems = {};

  const aadhaar = digits(form.documents?.aadhaarNumber);
  const pan = clean(form.documents?.panNumber);
  const accountName = String(form.bank?.accountName || "").trim();
  const account = digits(form.bank?.accountNumber);
  const ifsc = clean(form.bank?.ifsc);

  if (!aadhaar) problems.aadhaarNumber = "Aadhaar number is needed";
  else if (!AADHAAR.test(aadhaar)) problems.aadhaarNumber = "An Aadhaar is 12 digits";

  if (!pan) problems.panNumber = "PAN number is needed";
  else if (!PAN.test(pan)) problems.panNumber = "A PAN looks like ABCDE1234F";

  if (!accountName) problems.accountName = "Name on the account is needed";

  if (!account) problems.accountNumber = "Account number is needed";
  else if (!ACCOUNT.test(account)) problems.accountNumber = "9 to 18 digits";

  if (!ifsc) problems.ifsc = "IFSC is needed";
  else if (!IFSC.test(ifsc)) problems.ifsc = "An IFSC looks like HDFC0001234";

  return problems;
};
