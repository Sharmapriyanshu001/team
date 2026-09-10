import fs from "fs";

import User from "../models/User.js";

import { InvalidInput } from "./crud.js";
import { hashPassword } from "./password.js";
import { removeStoredFile, storedPath } from "./uploads.js";
import {
  applyStaffPaperwork,
  findPaperwork,
  paperworkFiles,
} from "./staffDocuments.js";

/**
 * Everything the panels need in order to manage a member of staff.
 *
 * Operations Managers, managers and employees are all User records, so the admin
 * panel has always built their four screens from one shared set of helpers.
 * The HR panel manages exactly the same people — an employee HR adds is the
 * same row the admin panel lists — so these moved out of routes/adminRoutes.js
 * to here rather than being copied.
 *
 * That matters beyond tidiness. The rules encoded below are the ones that are
 * expensive to get subtly different in two places: what the login password
 * falls back to, when a password reset must invalidate live sessions, and
 * which sub-documents are kept out of a list response. A second copy that
 * drifted on the last of those would quietly start putting the whole company's
 * Aadhaar numbers into a browser to render a table.
 */

/** Shared by every staff role. The password is hashed by the caller. */
export const staffBeforeSave = (payload) => {
  const data = { ...payload };

  // The password is hashed by the caller once it has been resolved
  delete data.password;

  // Empty strings from <select> inputs must not be cast to ObjectId
  if (!data.reportsTo) delete data.reportsTo;

  return data;
};

/**
 * The login password is the person's mobile number unless a different one is
 * typed in. That keeps the credentials easy to hand over, and the form shows
 * exactly what they will be.
 */
export const resolveLoginPassword = (payload, existing, label) => {
  const custom = (payload.password || "").trim();
  const phone = (payload.phone ?? existing?.phone ?? "").trim();

  if (custom) {
    if (custom.length < 6) {
      throw new InvalidInput("Password must be at least 6 characters");
    }
    return custom;
  }

  // No custom password: fall back to the mobile number
  if (!existing) {
    if (!phone) {
      throw new InvalidInput(`Enter a mobile number — it becomes the ${label}'s login password`);
    }
    if (phone.replace(/\D/g, "").length < 6) {
      throw new InvalidInput("Mobile number looks too short to use as a password");
    }
    return phone;
  }

  // On an update, leave the existing password alone unless the phone changed
  if (payload.phone !== undefined && payload.phone !== existing.phone && phone) {
    return phone;
  }
  return null;
};

const STAFF_LABELS = {
  manager: { label: "manager", entity: "Manager" },
  operations_manager: { label: "operations manager", entity: "Operations Manager" },
  employee: { label: "employee", entity: "Employee" },
};

/** The buildCrud config for one staff role. */
export const staffCrudOptions = (role) => {
  const { label, entity } = STAFF_LABELS[role] || STAFF_LABELS.employee;

  return {
    entity,
    searchFields: ["name", "email", "designation", "department", "phone"],
    filterFields: ["status", "department"],
    // The list answers with its own tiles and the departments that actually
    // exist, so the screen above it does not have to count a page of rows and
    // present that as the company.
    summary: true,
    scope: { role },
    createDefaults: { role },
    // A list of staff is a table of names and departments. Nobody reading one
    // needs the whole company's Aadhaar numbers and bank accounts in their
    // browser, so those three sub-documents are left out of it and fetched
    // only when one person is actually opened.
    select: "-password -documents -bank -previousEmployment",
    selectOne: "-password",
    populate: [{ path: "reportsTo", select: "name email" }],
    sort: { createdAt: -1 },
    beforeSave: (payload, req, existing) => {
      const password = resolveLoginPassword(payload, existing, label);
      const { data: withPapers, orphaned } = applyStaffPaperwork(payload, req, existing);
      const data = staffBeforeSave(withPapers);

      if (password) {
        data.password = hashPassword(password);
        // A reset is usually done because the old password should stop working
        // — the person was locked out, or it leaked. Leaving their live tokens
        // alone would make the reset cosmetic for another seven days.
        data.tokenVersion = (existing?.tokenVersion || 0) + 1;
      }
      data.role = role;

      // Documents this save replaced. Removed only once the record itself has
      // been written, so a failed save never takes the old file with it.
      if (orphaned.length) {
        req.res?.on("finish", () => {
          if (req.res.statusCode < 400) orphaned.forEach(removeStoredFile);
        });
      }

      return data;
    },
  };
};

/**
 * Serving one of a member of staff's documents back.
 *
 * Nothing under uploads/ is reachable without going through a route, which is
 * what makes this the only way to see somebody's Aadhaar scan — and why it is
 * mounted behind the same permission guard as the rest of their record rather
 * than being a link the browser could follow on its own.
 */
export const staffDocument = (role) => async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role }).select(
      "documents previousEmployment"
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const file = findPaperwork(user, req.params.field);
    const target = file && storedPath(file.storedName);
    if (!target) return res.status(404).json({ message: "That document is not on file" });

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    // Shown in a tab rather than pushed to the downloads folder: whoever is
    // looking is usually checking a card against a form, not collecting files.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(file.originalName || req.params.field).replace(/"/g, "")}"`
    );

    const stream = fs.createReadStream(target);
    stream.on("error", (err) => {
      console.error("staffDocument stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: "Could not read that document" });
    });
    return stream.pipe(res);
  } catch (err) {
    if (err.name === "CastError") return res.status(404).json({ message: "Not found" });
    console.error("staffDocument error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/** Deleting the person takes their paperwork off the disk with them. */
export const removeStaff = (role, crud) => async (req, res) => {
  const existing = await User.findOne({ _id: req.params.id, role }).select(
    "documents previousEmployment"
  );
  const files = existing ? paperworkFiles(existing) : [];

  res.on("finish", () => {
    if (res.statusCode < 400) files.forEach(removeStoredFile);
  });

  return crud.remove(req, res);
};
