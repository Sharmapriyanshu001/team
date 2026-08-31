import { useEffect, useState } from "react";
import leaderApi from "../leaderApi";

const EMPTY = { projects: [], team: [] };

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
    teamOptions: lookups.team.map((m) => ({
      value: m._id,
      label: m.designation ? `${m.name} — ${m.designation}` : m.name,
    })),
  };
}
