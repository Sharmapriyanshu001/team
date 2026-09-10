import { useEffect, useState } from "react";
import hrApi from "../hrApi";

/**
 * The people a leave or a candidate can be attached to.
 *
 * The admin panel has /admin/lookups for this; HR does not, and should not —
 * that endpoint also returns clients and projects, which is the sort of thing
 * a panel scoped to HR has no business fetching. So this asks the HR
 * employees list instead, which is the same question narrowed to HR's own.
 */
export default function useStaffOptions() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    hrApi
      .get("/hr/employees", { params: { limit: 200, status: "active" } })
      .then(({ data }) => active && setPeople(data.items || []))
      .catch(() => active && setPeople([]))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  return {
    people,
    loading,
    staffOptions: people.map((person) => ({
      value: person._id,
      label: person.designation ? `${person.name} — ${person.designation}` : person.name,
    })),
  };
}
