import { initialsOf } from "../format";

/**
 * Somebody's initials in a coloured circle.
 *
 * The colour is decided by the name rather than picked at random or stored, so
 * the same person is the same colour on every screen, on every page of a list,
 * and again tomorrow — which is what makes it worth anything while a table is
 * being scanned. Everybody in the same near-black circle made a page of twenty
 * people read as one repeated shape.
 *
 * Four tints, all from the panel's own palette. A wider spread would be easier
 * to tell apart and would stop looking like this application.
 */
const TONES = ["bg-slate-900", "bg-blue-600", "bg-sky-600", "bg-slate-500"];

const avatarTone = (name = "") => {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return TONES[sum % TONES.length];
};

const SIZES = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-9 w-9 text-[11px]",
  lg: "h-11 w-11 text-sm",
};

export default function Avatar({ name, size = "md", className = "" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        SIZES[size] || SIZES.md
      } ${avatarTone(name)} ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}
