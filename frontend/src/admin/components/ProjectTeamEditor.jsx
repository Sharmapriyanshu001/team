import { useMemo, useState } from "react";
import { Search, TriangleAlert, UserMinus, UserPlus, X } from "lucide-react";

import useLookups from "../hooks/useLookups";
import { Alert, Button, Field, Select } from "../../shared/components/ui";

/**
 * Put people on a project, from wherever the admin happens to be looking.
 *
 * Assigning used to mean leaving the list, opening Assign Team, finding the
 * project again in a second list and working there — so adding one person to
 * a project the admin was already reading about cost four navigations. This
 * is the same job done in place.
 *
 * It sends the whole membership rather than an add/remove instruction, which
 * is what Assign Team has always done and what the project endpoint expects.
 * That is safe here because an admin screen holds the current list in front
 * of the person editing it; it would not be safe from a background job.
 */

/**
 * A leader may only hand work to people who report to them, so somebody from
 * another leader's team can sit on a project unable to be given a task. Worth
 * saying at the moment of assigning rather than leaving them to wonder later
 * why the task dropdown is empty.
 */
const reportsElsewhere = (person, operationsManager) =>
  Boolean(operationsManager) && String(person.reportsTo?._id || person.reportsTo || "") !== String(operationsManager);

export default function ProjectTeamEditor({ project, onSave, onCancel, saving, error }) {
  const lookups = useLookups();

  /**
   * Seeded once from the project it was opened on.
   *
   * The caller keys this component by project id, so opening a different one
   * mounts a fresh editor rather than re-seeding this one — which is both
   * simpler than an effect that copies props into state and immune to the bug
   * that pattern invites, where a slow save leaves one project's team showing
   * under another project's name.
   */
  const [operationsManager, setOperationsManager] = useState(project?.operationsManager?._id || "");
  const [members, setMembers] = useState(() => (project?.members || []).map((m) => m._id));
  const [query, setQuery] = useState("");

  const toggle = (id) =>
    setMembers((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const chosen = useMemo(
    () => lookups.employees.filter((e) => members.includes(e._id)),
    [lookups.employees, members]
  );

  const available = useMemo(() => {
    const text = query.trim().toLowerCase();
    return lookups.employees.filter(
      (e) =>
        !members.includes(e._id) &&
        (!text ||
          e.name.toLowerCase().includes(text) ||
          (e.designation || "").toLowerCase().includes(text))
    );
  }, [lookups.employees, members, query]);

  const strays = chosen.filter((e) => reportsElsewhere(e, operationsManager));

  // Nothing to save is not an error, but the button should say so
  const unchanged =
    String(project?.operationsManager?._id || "") === String(operationsManager || "") &&
    members.length === (project?.members || []).length &&
    (project?.members || []).every((m) => members.includes(m._id));

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <Alert>{error}</Alert>

      <Field label="Operations Manager" className="max-w-sm">
        <Select
          value={operationsManager}
          onChange={(e) => setOperationsManager(e.target.value)}
          placeholder="No operations manager"
          options={lookups.leaderOptions}
        />
      </Field>

      {/* ------------------------------------------------------ who is on it */}

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-slate-700">
          On this project
          <span className="ml-1.5 font-normal text-slate-400">{members.length}</span>
        </p>

        {chosen.length ? (
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((person) => {
              const stray = reportsElsewhere(person, operationsManager);
              return (
                <span
                  key={person._id}
                  className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-xs ring-1 ring-inset ${
                    stray
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-white text-slate-700 ring-slate-200"
                  }`}
                >
                  {person.name}
                  <button
                    type="button"
                    onClick={() => toggle(person._id)}
                    title={`Take ${person.name} off this project`}
                    className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Nobody yet.</p>
        )}

        {strays.length > 0 && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              {strays.map((e) => e.name).join(", ")} {strays.length === 1 ? "reports" : "report"} to
              another operations manager, so this project's leader cannot give them tasks. Change their
              &quot;Reports to&quot; under Employees, or pick somebody from this leader&apos;s team.
            </span>
          </p>
        )}
      </div>

      {/* --------------------------------------------------------- adding more */}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-700">Add somebody</p>
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees"
              className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-xs outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {available.map((person) => (
            <button
              key={person._id}
              type="button"
              onClick={() => toggle(person._id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
            >
              <UserPlus size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-800">{person.name}</span>
                <span className="block truncate text-[11px] text-slate-400">
                  {person.designation || "Employee"}
                  {person.reportsTo?.name ? ` · reports to ${person.reportsTo.name}` : " · no leader"}
                </span>
              </span>
            </button>
          ))}

          {!available.length && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {lookups.employees.length
                ? query
                  ? `Nobody matches "${query}"`
                  : "Everybody is already on this project."
                : "No employees yet — add them under Employees first."}
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- saving */}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={unchanged}
          onClick={() => onSave({ operationsManager, members })}
          type="button"
        >
          <UserMinus size={13} className="rotate-180" />
          {unchanged ? "No changes" : "Save team"}
        </Button>
      </div>
    </div>
  );
}
