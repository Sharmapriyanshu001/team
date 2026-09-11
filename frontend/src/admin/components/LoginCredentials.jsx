import { useState } from "react";
import { KeyRound, Copy, Check, ShieldAlert } from "lucide-react";

import { Field, Input } from "../../shared/components/ui";
import { DEFAULT_PASSWORD } from "../../shared/staffPassword";

/**
 * A read-only credential line with a copy-to-clipboard button. `display` lets a
 * caller mask what is on screen — the button still copies the real `value`.
 */
export function CopyRow({ label, value, display, hint }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the value is on screen either way
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate font-mono text-sm font-medium text-slate-900">
          {display || value || <span className="font-sans text-slate-400">—</span>}
        </p>
        {value && (
          <button
            type="button"
            onClick={copy}
            title={`Copy ${label.toLowerCase()}`}
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            {copied ? <Check size={14} className="text-blue-600" /> : <Copy size={14} />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * The credentials block on the Add/Edit forms. It mirrors exactly what the
 * server will store: the login ID is the email, and the password is the
 * starting password every new account gets unless the admin types a different
 * one here.
 */
export default function LoginCredentials({
  email,
  password,
  onPasswordChange,
  isEdit,
  roleLabel,
  /**
   * Whether this panel may set the password at all.
   *
   * False for HR editing a record: /api/hr/employees/:id strips the password
   * out of every save on purpose — HR maintains the record and does not hand
   * out access — so offering the box would be offering a field that reports
   * success and changes nothing.
   */
  canSetPassword = true,
  children,
}) {
  const effective = (password || "").trim() || DEFAULT_PASSWORD;

  return (
    <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <KeyRound size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Login details</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {canSetPassword
              ? `Share these with the ${roleLabel}. Only you can create or change them.`
              : `Share the login ID with the ${roleLabel}. Changing the password is an administrator's job.`}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CopyRow label="Login ID" value={email} hint="Their email address is the login ID" />
        <CopyRow
          label="Password"
          value={isEdit && !password ? "" : effective}
          hint={
            isEdit && !password
              ? canSetPassword
                ? "Unchanged. Type a new one below to reset it."
                : "Unchanged — only an administrator can reset it."
              : (password || "").trim()
                ? "Custom password you typed below"
                : "The starting password every new account gets"
          }
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {canSetPassword && (
          <Field
            label="Custom password"
            hint={
              isEdit
                ? "Leave blank to keep the current password"
                : `Leave blank to use ${DEFAULT_PASSWORD}`
            }
          >
            <Input
              name="password"
              type="text"
              value={password}
              onChange={onPasswordChange}
              placeholder={DEFAULT_PASSWORD}
              autoComplete="new-password"
            />
          </Field>
        )}

        {children}
      </div>

      {canSetPassword && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          The starting password is the same for everybody, so ask them to change it from their own
          Profile page at the first sign-in.
        </p>
      )}
    </div>
  );
}
