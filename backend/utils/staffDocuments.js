import { removeStoredFile, STAFF_DOC_FIELDS } from "./uploads.js";

/**
 * The onboarding paperwork: turning what a four-step form sends into the three
 * sub-documents a User carries, and refusing what does not look like a real
 * Aadhaar, PAN or bank account.
 *
 * Kept out of the route file because it is the only part of adding a member of
 * staff that is neither generic CRUD nor about their login — and because team
 * leaders and employees go through exactly the same paperwork, so it has to be
 * one implementation or it will drift into two.
 */

/** Which sub-document each uploaded file belongs to. */
const FILE_OWNER = {
  aadhaarFront: "documents",
  aadhaarBack: "documents",
  panFront: "documents",
  panBack: "documents",
  resume: "documents",
  experienceLetter: "previousEmployment",
  salarySlip: "previousEmployment",
  relievingLetter: "previousEmployment",
};

const SECTIONS = ["documents", "bank", "previousEmployment"];

/**
 * What a new joiner must hand over. The last step — where they worked before —
 * is deliberately absent: a fresher has none of it, and an experienced hire
 * often brings the letters weeks after starting.
 *
 * Checked only when the record is created. An account that predates any of
 * this has to stay editable, and refusing to save a corrected phone number
 * because a five-year-old employee record has no PAN scan on file would be a
 * strange thing for a form to do.
 */
/**
 * Nothing here is required to open an account.
 *
 * It used to be: Aadhaar, PAN, four scans and full bank details all had to be
 * present before a new employee could be saved at all. That is not how hiring
 * works — somebody starts on Monday and the PAN card photo arrives on
 * Thursday — so in practice it did not enforce good records, it stopped the
 * login being created and the person spent their first week unable to see
 * their own tasks.
 *
 * The paperwork is still collected on the same form and still validated for
 * shape when it is filled in; it simply no longer holds up the account. What
 * is missing is visible on the employee's own record, which is where somebody
 * chasing it will look.
 */

/**
 * The identity and bank formats are checked in the browser now, beside the box
 * that is wrong — see validateStep in admin/pages/staff/StaffForm.jsx. The
 * server normalises what it is given and stores it; refusing a five-step form
 * over one mistyped digit threw away everything else on it.
 */

/**
 * A section arrives as a JSON string over multipart and as an object over
 * plain JSON, and this form sends either depending on whether a file was
 * picked. Anything unreadable is treated as "not sent" rather than as an
 * error: a section nobody filled in is the ordinary case.
 */
const parseSection = (raw) => {
  if (!raw) return null;
  if (typeof raw === "object") return raw;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

/** What gets stored about one uploaded file. */
const describe = (file) => ({
  storedName: file.filename,
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size,
  uploadedAt: new Date(),
});

/** A sub-document off an existing record, as a plain object. */
const currentOf = (existing, section) => {
  const value = existing?.[section];
  if (!value) return {};
  return typeof value.toObject === "function" ? value.toObject() : { ...value };
};

const trim = (value) => String(value ?? "").trim();

/**
 * Fold what the form sent, and whatever files came with it, onto what is
 * already on the record.
 *
 * Merged rather than replaced, and that is the point of this function: an edit
 * that only touches the basic details sends no Aadhaar photo, and writing the
 * sub-document wholesale would take the stored one off the record while
 * leaving the bytes on disk forever.
 */
export const applyStaffPaperwork = (payload, req, existing) => {
  const data = { ...payload };
  const files = req.files || {};
  const isNew = !existing;

  // Whatever the previous version pointed at that nothing points at any more
  const orphaned = [];

  SECTIONS.forEach((section) => {
    const sent = parseSection(payload[section]);
    const current = currentOf(existing, section);

    const hasFile = STAFF_DOC_FIELDS.some(
      (field) => FILE_OWNER[field] === section && files[field]
    );

    // Untouched by this request: leave the record as it is, rather than
    // writing an empty sub-document over it
    if (!sent && !hasFile) {
      delete data[section];
      return;
    }

    const next = { ...current };

    // Text fields, and only the ones actually sent — a request that carries
    // three of a section's fields must not blank the other three
    Object.entries(sent || {}).forEach(([key, value]) => {
      if (FILE_OWNER[key]) return; // files never arrive as text
      next[key] = typeof value === "string" ? value.trim() : value;
    });

    // A new file replaces what was there, and the replaced one stops being
    // anybody's
    STAFF_DOC_FIELDS.filter((field) => FILE_OWNER[field] === section).forEach((field) => {
      const uploaded = files[field]?.[0];
      if (!uploaded) return;

      if (current[field]?.storedName) orphaned.push(current[field].storedName);
      next[field] = describe(uploaded);
    });

    data[section] = next;
  });

  /* --------------------------------------------------------------- shape */

  const documents = data.documents;
  if (documents) {
    const aadhaar = trim(documents.aadhaarNumber).replace(/[\s-]/g, "");
    const pan = trim(documents.panNumber).toUpperCase();

    /**
     * Normalised, not refused.
     *
     * Refusing the save over a mistyped Aadhaar discarded every other field on
     * a five-step form. The shape is still checked in the browser, where it
     * can be pointed at beside the box that is wrong rather than losing the
     * page — see validateStep in admin/pages/staff/StaffForm.jsx.
     */

    documents.aadhaarNumber = aadhaar;
    documents.panNumber = pan;
  }

  const bank = data.bank;
  if (bank) {
    const account = trim(bank.accountNumber).replace(/[\s-]/g, "");
    const ifsc = trim(bank.ifsc).toUpperCase();

    // Stored as entered, for the same reason as the identity numbers above.

    bank.accountNumber = account;
    bank.ifsc = ifsc;
  }

  /* ----------------------------------------------------- present at all */

  return { data, orphaned };
};

/**
 * Files whose record never got written.
 *
 * Multer has already put every upload on disk by the time a handler runs, so a
 * request refused for any reason — a duplicate email, a malformed PAN, a
 * database that was down — leaves files behind that nothing will ever point
 * at. Hooking the response rather than each failure path is what makes that
 * true for the reasons nobody thought of too.
 */
export const discardUploadsIfRefused = (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode < 400) return;

    Object.values(req.files || {})
      .flat()
      .forEach((file) => removeStoredFile(file.filename));
  });

  next();
};

/** Every stored file on a staff record, for when the record itself goes. */
export const paperworkFiles = (user) =>
  STAFF_DOC_FIELDS.map((field) => user?.[FILE_OWNER[field]]?.[field]?.storedName).filter(Boolean);

/**
 * One file off a multipart request, in the shape a User stores it.
 *
 * The joining form sends its papers through applyStaffPaperwork above, but a
 * hire is not that form — it sends one CV and nothing else — and reaching for
 * the whole four-step merge to file a single upload would be the long way
 * round. This is the same descriptor, exported so both roads write the record
 * identically.
 */
export const uploadedAs = (req, field) => {
  const file = req.files?.[field]?.[0];
  return file ? describe(file) : null;
};

/** Locate one document on a user, whichever sub-document it lives in. */
export const findPaperwork = (user, field) => {
  const section = FILE_OWNER[field];
  if (!section) return null;

  const file = user?.[section]?.[field];
  return file?.storedName ? file : null;
};
