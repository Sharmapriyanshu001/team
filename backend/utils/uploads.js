import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";

/**
 * Disk storage for uploaded archives. Files land outside the API surface —
 * nothing is served statically, every read goes through a route that checks
 * who is asking.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR = path.resolve(here, "..", "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const ZIP_MIME_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "multipart/x-zip",
  "application/octet-stream", // some browsers send this for .zip
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // A random name keeps two uploads of "build.zip" apart and makes the stored
  // path impossible to guess or traverse.
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.zip`),
});

const zipOnly = (req, file, cb) => {
  const isZipName = /\.zip$/i.test(file.originalname || "");
  const isZipType = ZIP_MIME_TYPES.includes(file.mimetype);

  // The extension is the honest signal here — the browser's mime type for a
  // .zip varies by OS, so it is only used to reject obvious mismatches.
  if (!isZipName || !isZipType) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only .zip files can be uploaded"));
  }
  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: zipOnly,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * Multer as ordinary middleware, but a rejected upload answers with a clean
 * 400 instead of falling through to Express's default error page.
 */
export const uploadZip = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: `File is too large — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ message: err.field || "Only .zip files can be uploaded" });
    }

    console.error("upload error:", err.message);
    return res.status(400).json({ message: "Could not read the uploaded file" });
  });

/* ------------------------------------------------------- staff documents */

/**
 * The proof-of-identity and employment papers collected when somebody is
 * added: an Aadhaar and a PAN card photographed front and back, and whatever
 * their last employer gave them.
 *
 * Separate from the archive upload above because almost nothing about it is
 * the same — several files at once instead of one, images and PDFs instead of
 * ZIPs, a much smaller ceiling, and each file has to keep its own extension so
 * it can be handed back to a browser that knows what to do with it.
 */
export const STAFF_DOC_FIELDS = [
  "aadhaarFront",
  "aadhaarBack",
  "panFront",
  "panBack",
  // The CV, which arrives with the hire rather than with the paperwork
  "resume",
  "experienceLetter",
  "salarySlip",
  "relievingLetter",
];

export const MAX_DOC_BYTES = 8 * 1024 * 1024; // 8 MB — a phone photo of a card

const DOC_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".pdf"];

const DOC_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/octet-stream", // some phones send this for .heic
];

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // The extension is kept — unlike an archive, these are handed back to a
    // browser later and it decides how to show them from the name and type.
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safe = DOC_EXTENSIONS.includes(ext) ? ext : "";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safe}`);
  },
});

const documentsOnly = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (!DOC_EXTENSIONS.includes(ext) || !DOC_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Upload a photo or a PDF (JPG, PNG or PDF)")
    );
  }
  return cb(null, true);
};

const docUpload = multer({
  storage: docStorage,
  fileFilter: documentsOnly,
  limits: { fileSize: MAX_DOC_BYTES, files: STAFF_DOC_FIELDS.length },
});

/**
 * Accepts the document fields and nothing else, so a form cannot smuggle an
 * eighth file through under a name the server has no place to put.
 *
 * Every field is optional: a form that fills none of them is a plain create,
 * exactly as it was before documents existed.
 */
export const uploadStaffDocuments = (req, res, next) =>
  docUpload.fields(STAFF_DOC_FIELDS.map((name) => ({ name, maxCount: 1 })))(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: `That file is too large — the limit is ${MAX_DOC_BYTES / 1024 / 1024} MB` });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .json({ message: err.field || "Upload a photo or a PDF (JPG, PNG or PDF)" });
    }

    console.error("document upload error:", err.message);
    return res.status(400).json({ message: "Could not read the uploaded file" });
  });

/** Absolute path of a stored file, or null if the name is not one of ours. */
export const storedPath = (storedName) => {
  if (!storedName) return null;

  const resolved = path.resolve(UPLOAD_DIR, storedName);
  // Belt and braces: never resolve outside the uploads folder
  if (!resolved.startsWith(UPLOAD_DIR)) return null;

  return fs.existsSync(resolved) ? resolved : null;
};

/**
 * A second copy of an already-stored archive, under a fresh random name.
 *
 * One ZIP handed to five people becomes five records, and each has to own its
 * bytes — otherwise deleting any one of them would pull the download out from
 * under the other four.
 */
export const copyStoredFile = (storedName) => {
  const source = storedPath(storedName);
  if (!source) return null;

  const copyName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.zip`;
  fs.copyFileSync(source, path.join(UPLOAD_DIR, copyName));
  return copyName;
};

/** Best-effort cleanup. A missing file must never fail the request. */
export const removeStoredFile = (storedName) => {
  const target = storedPath(storedName);
  if (!target) return;

  fs.unlink(target, (err) => {
    if (err) console.error("removeStoredFile error:", err.message);
  });
};
