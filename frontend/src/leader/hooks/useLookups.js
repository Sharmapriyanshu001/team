import { useEffect, useState } from "react";
import leaderApi from "../leaderApi";

const EMPTY = { projects: [], team: [], departments: [] };

// Dropdown options limited to the leader's own projects and team.
export default function useLookups() {
  const [lookups, setLookups] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/lookups")
      .then(({ data }) => active && setLookups({ ...EMPTY, ...data }))
      .catch(() => active && setLookups(EMPTY))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  return {
    ...lookups,
    loading,
    projectOptions: lookups.projects.map((p) => ({
      value: p._id,
      label: p.code ? `${p.code} — ${p.name}` : p.name,
    })),
    /**
     * Everybody this account may give work to, their own people first.
     *
     * The ones who do not report to them are marked rather than left out, the
     * way Assign Work marks them: a leader borrowing somebody else s developer
     * is allowed and ordinary, but it should not happen by accident because
     * two people on the list had the same first name.
     */
    teamOptions: lookups.team.map((m) => ({
      value: m._id,
      label: [
        m.name,
        m.designation ? ` — ${m.designation}` : "",
        m.reportsToMe === false ? " (other team)" : "",
      ].join(""),
    })),
    /**
     * Only the people who actually report to this account.
     *
     * Tasks and issues do not have the same rule, and the difference is the
     * server s, not a preference: a task may go to any active employee, but
     * both issue handlers refuse an assignee who is not in the leader s own
     * scope. Offering the wide list there would put names in a dropdown that
     * come back as "You can only assign issues to your own team".
     *
     * Derived from the same payload rather than fetched again — the flag on
     * each row is what the two lists differ by.
     */
    myTeamOptions: lookups.team
      .filter((m) => m.reportsToMe)
      .map((m) => ({
        value: m._id,
        label: m.designation ? `${m.name} — ${m.designation}` : m.name,
      })),

    /**
     * The departments this account manages — empty for an operations manager who
     * manages none, which is what makes the whole department option vanish
     * for them rather than showing an empty dropdown.
     */
    departmentOptions: lookups.departments.map((d) => ({
      value: d._id,
      label: d.kind && d.kind !== "other" ? `${d.name} — ${d.kind}` : d.name,
    })),
    managesDepartment: lookups.departments.length > 0,
  };
}
