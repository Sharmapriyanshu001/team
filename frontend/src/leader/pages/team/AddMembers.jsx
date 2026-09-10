import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Search, UserPlus, Users } from "lucide-react";

import leaderApi from "../../leaderApi";
import Modal from "../../../shared/components/Modal";
import { Alert, Badge, Button, EmptyState, Loader } from "../../../shared/components/ui";

/**
 * Picking people for your own team.
 *
 * Every employee is listed, not just the ones nobody is leading — in a company
 * where everybody already has a leader, a list of the unassigned is an empty
 * list, and the feature would do nothing.
 *
 * So taking somebody from a colleague is allowed, and the screen makes sure it
 * is never an accident: each row says who that person answers to today, anyone
 * already on your team is shown as such and cannot be picked again, and taking
 * people from other teams is called out before you press the button. Their old
 * leader is told afterwards.
 */

const initialsOf = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function AddMembers({ open, onClose, onAdded }) {
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * Re-read every time it opens. Somebody may have moved since the last look,
   * and a stale list is how a leader thinks they are taking a free agent and
   * is actually taking one of a colleague's people.
   */
  useEffect(() => {
    if (!open) return undefined;

    let active = true;
    setLoading(true);
    setError("");
    setPicked([]);

    leaderApi
      .get("/leader/team/available", { params: { search: search.trim() || undefined } })
      .then(({ data }) => active && setPeople(data.items || []))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load the list"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [open, search]);

  const toggle = (id) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id]
    );

  /** How many of the chosen are being taken off somebody else's team. */
  const takingFromOthers = useMemo(
    () => people.filter((p) => picked.includes(p._id) && p.onAnotherTeam).length,
    [people, picked]
  );

  const add = async () => {
    setSaving(true);
    setError("");

    try {
      const { data } = await leaderApi.post("/leader/team/members", { employees: picked });
      onAdded?.(data.message);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add them to your team");
    } finally {
      setSaving(false);
    }
  };

  const selectable = people.filter((person) => !person.onMyTeam);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add people to your team"
      subtitle="Everybody who works here — the ones already on your team are marked"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} loading={saving} disabled={!picked.length}>
            <UserPlus size={15} />
            {picked.length ? `Add ${picked.length}` : "Add"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert>{error}</Alert>

        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or designation"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
          />
        </div>

        {/* Said before the button is pressed, not after */}
        {takingFromOthers > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {takingFromOthers === 1
              ? "One of these already reports to another operations manager. They will be moved, and their current leader will be told."
              : `${takingFromOthers} of these already report to other operations managers. They will be moved, and their current leaders will be told.`}
          </div>
        )}

        {loading ? (
          <Loader label="Loading people…" />
        ) : people.length ? (
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {people.map((person) => {
              const chosen = picked.includes(person._id);
              const mine = person.onMyTeam;

              return (
                <li key={person._id}>
                  <label
                    className={`flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors ${
                      mine
                        ? "cursor-default opacity-60"
                        : `cursor-pointer ${chosen ? "bg-blue-50" : "hover:bg-slate-50"}`
                    }`}
                  >
                    {mine ? (
                      // Already yours — shown, so the list is the whole company,
                      // but not offered again
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-slate-100 text-slate-500">
                        <Check size={11} />
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={chosen}
                        onChange={() => toggle(person._id)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600"
                      />
                    )}

                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                      {initialsOf(person.name)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {person.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {person.designation || "—"}
                        {person.department ? ` · ${person.department}` : ""}
                      </span>
                    </span>

                    {/* Who they answer to today — the thing that turns this from
                        a grab into a decision */}
                    <span className="shrink-0 text-right">
                      {mine ? (
                        <Badge tone="blue">On your team</Badge>
                      ) : person.currentLeader ? (
                        <span className="text-[11px] text-amber-700">
                          With {person.currentLeader.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">No team</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={Users}
            title={search ? "Nobody matches that" : "No employees yet"}
            message={
              search
                ? "Try a different name."
                : "Employees appear here as soon as an admin adds them."
            }
          />
        )}

        {!loading && people.length > 0 && (
          <p className="text-[11px] text-slate-500">
            {selectable.length} available to add · {people.length - selectable.length} already on
            your team
          </p>
        )}
      </div>
    </Modal>
  );
}
