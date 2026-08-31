import crypto from "crypto";

/**
 * Encrypting the things that must never be readable from a database dump:
 * Play console logins, cPanel, FTP, WordPress admins, social passwords.
 *
 * AES-256-GCM, which is authenticated — a ciphertext that has been tampered
 * with fails to decrypt rather than quietly returning different bytes. That
 * matters more here than speed: the failure mode of an unauthenticated cipher
 * is a password that is subtly wrong, and nobody would suspect the database.
 *
 * Stored as one string, "v1:<iv>:<tag>:<ciphertext>", all base64url. The
 * version prefix is there so a future key rotation can tell old rows from new
 * ones without guessing at the format.
 *
 * ── the key ──────────────────────────────────────────────────────────────
 * VAULT_KEY is separate from JWT_SECRET on purpose. They protect different
 * things and leak through different holes: a signing key that turns up in a
 * log has cost you sessions, and this one has cost you every client's
 * hosting. Sharing one value would mean one leak costs both.
 *
 * It is derived to 32 bytes with scrypt and a fixed salt, so any reasonably
 * long passphrase works and the same passphrase always produces the same key.
 * A fixed salt is fine here — the input is a high-entropy secret, not a
 * password somebody chose, so there is no rainbow table to defend against.
 *
 * LOSING THIS KEY MEANS LOSING EVERY SECRET IN THE VAULT. There is no
 * recovery, by design. Back it up somewhere that is not this server.
 */

const MIN_KEY_LENGTH = 32;
const SALT = "office-panel/vault/v1";

let cached = null;

/** The reason the vault cannot be used, or null if it can. */
export const vaultProblem = () => {
  const key = process.env.VAULT_KEY || "";
  if (!key) return "VAULT_KEY is not set on the server, so the vault is switched off";
  if (key.length < MIN_KEY_LENGTH) {
    return `VAULT_KEY is too short — use at least ${MIN_KEY_LENGTH} characters`;
  }
  return null;
};

export const vaultReady = () => vaultProblem() === null;

const keyBytes = () => {
  const problem = vaultProblem();
  if (problem) throw new Error(problem);

  if (!cached) cached = crypto.scryptSync(process.env.VAULT_KEY, SALT, 32);
  return cached;
};

/** Plain text in, "v1:iv:tag:ciphertext" out. */
export const seal = (plain) => {
  if (plain === undefined || plain === null || plain === "") return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);

  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    body.toString("base64url"),
  ].join(":");
};

/**
 * The reverse. Throws on a wrong key or a tampered value rather than
 * returning something plausible — a vault that quietly hands back the wrong
 * password is worse than one that says it is broken.
 */
export const open = (sealed) => {
  if (!sealed) return "";

  const [version, iv, tag, body] = String(sealed).split(":");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new Error("That stored secret is not in a format this server understands");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "That secret could not be decrypted — VAULT_KEY has changed since it was saved"
    );
  }
};

/** Forget the derived key. Only used by tests that change VAULT_KEY. */
export const resetKeyCache = () => {
  cached = null;
};
