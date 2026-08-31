import crypto from "crypto";

// Hash a password using Node's built-in scrypt (no external dependency needed).
// Format stored in DB: "<salt>:<hash>"
export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

// Compare a plain password against the stored "<salt>:<hash>" value.
export const comparePassword = (password, stored) => {
  if (!stored || !stored.includes(":")) return false;
  const [salt, originalHash] = stored.split(":");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  const hashBuffer = Buffer.from(hash, "hex");
  const originalBuffer = Buffer.from(originalHash, "hex");
  if (hashBuffer.length !== originalBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, originalBuffer);
};
