import { useEffect, useState } from "react";
import hrApi from "../hrApi";

/**
 * The operations managers somebody can be told to report to.
 *
 * The admin panel reads this out of /admin/lookups, which also carries clients
 * and projects — things a panel scoped to HR has no business fetching. So this
 * asks HR's own operations managers list instead, which is the same question
 * narrowed to what HR may see.
 */
export default function useLeaderOptions() {
  const [leaders, setLeaders] = useState([]);

  useEffect(() => {
    let active = true;

    hrApi
      .get("/hr/operations-managers", { params: { limit: 200, status: "active" } })
      .then(({ data }) => active && setLeaders(data.items || []))
      .catch(() => active && setLeaders([]));

    return () => {
      active = false;
    };
  }, []);

  return leaders.map((person) => ({
    value: person._id,
    label: person.designation ? `${person.name} — ${person.designation}` : person.name,
  }));
}
