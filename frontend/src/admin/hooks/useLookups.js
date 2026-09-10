import { useEffect, useState } from "react";
import adminApi from "../adminApi";

const EMPTY = { clients: [], operationsManagers: [], employees: [], projects: [], staff: [] };

// Dropdown options (clients / staff / projects) shared by every form.
export default function useLookups() {
  const [lookups, setLookups] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/lookups")
      .then(({ data }) => active && setLookups({ ...EMPTY, ...data }))
      .catch(() => active && setLookups(EMPTY))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  // Ready-to-use <Select> options
  const toOptions = (list) =>
    list.map((item) => ({
      value: item._id,
      label: item.company ? `${item.name} — ${item.company}` : item.name,
    }));

  return {
    ...lookups,
    loading,
    clientOptions: toOptions(lookups.clients),
    leaderOptions: toOptions(lookups.operationsManagers),
    employeeOptions: toOptions(lookups.employees),
    staffOptions: toOptions(lookups.staff),
    projectOptions: lookups.projects.map((p) => ({
      value: p._id,
      label: p.code ? `${p.code} — ${p.name}` : p.name,
    })),
  };
}
