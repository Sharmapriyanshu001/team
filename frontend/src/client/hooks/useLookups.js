import { useEffect, useState } from "react";
import clientApi from "../clientApi";

const EMPTY = { projects: [] };

// Dropdown options limited to the client's own projects.
export default function useLookups() {
  const [lookups, setLookups] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    clientApi
      .get("/client/lookups")
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
  };
}
