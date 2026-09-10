import { useEffect, useState } from "react";
import hrApi from "../hrApi";

/**
 * The openings and the people the hiring forms need.
 *
 * Its own endpoint rather than the HR employees list, because two of the three
 * forms want a vacancy to attach to and none of them wants a paginated staff
 * table. One request, shared by every hiring screen that mounts.
 */
export default function useHiringLookups() {
  const [data, setData] = useState({ openings: [], staff: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    hrApi
      .get("/hr/hiring/lookups")
      .then(({ data: body }) => active && setData({ openings: body.openings || [], staff: body.staff || [] }))
      .catch(() => active && setData({ openings: [], staff: [] }))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  return {
    ...data,
    loading,
    openingOptions: data.openings.map((opening) => ({
      value: opening._id,
      label: opening.code ? `${opening.code} — ${opening.title}` : opening.title,
    })),
    staffOptions: data.staff.map((person) => ({
      value: person._id,
      label: person.designation ? `${person.name} — ${person.designation}` : person.name,
    })),
  };
}
