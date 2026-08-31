import { useEffect, useState } from "react";
import employeeApi from "../employeeApi";

const EMPTY = { projects: [], tasks: [] };

// Dropdown options limited to the employee's own projects.
export default function useLookups() {
  const [lookups, setLookups] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    employeeApi
      .get("/employee/lookups")
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
     * The employee's own open tasks, for naming what a code submission was
     * done for. Completed ones are already left out by the server — there is
     * nothing to submit against work the team leader has signed off.
     */
    taskOptions: lookups.tasks.map((t) => ({
      value: t._id,
      label: t.title,
    })),
  };
}
