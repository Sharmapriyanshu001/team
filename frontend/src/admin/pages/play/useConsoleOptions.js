import { useEffect, useState } from "react";

import adminApi from "../../adminApi";

/**
 * Every console, as dropdown options.
 *
 * Its own hook rather than another entry in useLookups because that endpoint
 * is fetched by every form in the panel, and most of them have no use for a
 * list of developer accounts. This one is asked for only where it is needed.
 */
export const useConsoleOptions = () => {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/play/consoles", { params: { limit: 200 } })
      .then(({ data }) => {
        if (!active) return;
        setOptions(
          (data.items || []).map((row) => ({
            value: row._id,
            label: row.client?.name ? `${row.name} — ${row.client.name}` : row.name,
          }))
        );
      })
      .catch(() => active && setOptions([]));

    return () => {
      active = false;
    };
  }, []);

  return options;
};
