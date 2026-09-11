import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Builds the list/form hooks for one panel.
 *
 *   const { useCrud, useRecordForm } = makeCrudHooks(adminApi, "/admin");
 *   const crud = useCrud("clients");        // -> GET /admin/clients
 *
 * Both panels talk to the same shaped endpoints (buildCrud on the server), so
 * only the axios instance and the path prefix differ.
 */
export const makeCrudHooks = (api, base) => {
  /**
   * List state: search debouncing, filters, pagination and mutations.
   *
   * `loading` is switched on by the handlers that trigger a refetch, and off
   * when the response lands, so the effect never sets state synchronously.
   */
  const useCrud = (resource, { initialFilters = {}, limit = 25 } = {}) => {
    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
    /**
     * The tiles above the table, when the endpoint sends them: how many
     * records there are in total, how many are active, and which departments
     * exist. Null for every list that does not — see buildCrud's `summary`.
     */
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [filters, setFilters] = useState(initialFilters);
    const [page, setPage] = useState(1);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
      const timer = setTimeout(() => setDebouncedSearch(search), 350);
      return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
      let active = true;

      api
        .get(`${base}/${resource}`, {
          params: { ...filters, search: debouncedSearch, page, limit },
        })
        .then(({ data }) => {
          if (!active) return;
          setRows(data.items || []);
          setMeta({ total: data.total || 0, page: data.page || 1, pages: data.pages || 1 });
          // Kept from the previous response when one arrives without it, so
          // the tiles do not blink empty between pages
          if (data.summary) setSummary(data.summary);
          setError("");
        })
        .catch((err) => {
          if (!active) return;
          setError(err.response?.data?.message || "Could not load data");
          setRows([]);
        })
        .finally(() => active && setLoading(false));

      return () => {
        active = false;
      };
    }, [resource, filters, debouncedSearch, page, limit, reloadKey]);

    const refresh = useCallback(() => {
      setLoading(true);
      setReloadKey((key) => key + 1);
    }, []);

    // Changing a filter or the search term must reset back to the first page.
    const setFilter = useCallback((key, value) => {
      setLoading(true);
      setPage(1);
      setFilters((prev) => ({ ...prev, [key]: value }));
    }, []);

    const onSearch = useCallback((value) => {
      setLoading(true);
      setPage(1);
      setSearch(value);
    }, []);

    const onPageChange = useCallback((value) => {
      setLoading(true);
      setPage(value);
    }, []);

    const create = useCallback(
      async (payload) => {
        const { data } = await api.post(`${base}/${resource}`, payload);
        refresh();
        return data;
      },
      [resource, refresh]
    );

    const update = useCallback(
      async (id, payload) => {
        const { data } = await api.put(`${base}/${resource}/${id}`, payload);
        refresh();
        return data;
      },
      [resource, refresh]
    );

    const remove = useCallback(
      async (id) => {
        await api.delete(`${base}/${resource}/${id}`);
        refresh();
      },
      [resource, refresh]
    );

    return {
      rows,
      loading,
      error,
      setError,
      summary,
      ...meta,
      page,
      setPage: onPageChange,
      search,
      setSearch: onSearch,
      filters,
      setFilter,
      refresh,
      create,
      update,
      remove,
    };
  };

  /**
   * Powers "Add X" pages, which double as edit forms when the URL carries
   * `?id=<recordId>`. `toForm` maps a fetched record onto form values.
   */
  const useRecordForm = (resource, initialValues, toForm) => {
    const [params, setParams] = useSearchParams();
    const id = params.get("id");

    const [form, setForm] = useState(initialValues);
    // An edit page starts in a loading state; a blank "add" page does not.
    const [loading, setLoading] = useState(Boolean(id));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
      if (!id) return undefined;

      let active = true;

      api
        .get(`${base}/${resource}/${id}`)
        .then(({ data }) => {
          if (!active) return;
          setForm({ ...initialValues, ...(toForm ? toForm(data.item) : data.item) });
        })
        .catch((err) => {
          if (active) setError(err.response?.data?.message || "Could not load record");
        })
        .finally(() => active && setLoading(false));

      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, resource]);

    const change = useCallback((e) => {
      const { name, value, type, checked } = e.target;
      setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    }, []);

    const setValue = useCallback((name, value) => {
      setForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const reset = useCallback(() => {
      setForm(initialValues);
      setError("");
      setSuccess("");
      setLoading(false);
      setParams({});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setParams]);

    /** `payload` lets a page clean values before they hit the API. */
    const submit = useCallback(
      async (payload = form, { keepValues = false } = {}) => {
        setSaving(true);
        setError("");
        setSuccess("");

        try {
          /**
           * The saved record comes back, not just `true`.
           *
           * Anything that has to do a second thing to the record it just
           * created — attach a file to a new task, say — needs its id, and
           * a bare boolean left the caller with no way to get one. Still
           * truthy, so every `if (ok)` already written keeps working, and
           * failure is still plain `false`.
           */
          if (id) {
            const { data } = await api.put(`${base}/${resource}/${id}`, payload);
            setSuccess("Changes saved successfully");
            return data?.item || data || true;
          }

          const { data } = await api.post(`${base}/${resource}`, payload);
          setSuccess("Record created successfully");
          if (!keepValues) setForm(initialValues);
          return data?.item || data || true;
        } catch (err) {
          setError(err.response?.data?.message || "Could not save. Please try again.");
          return false;
        } finally {
          setSaving(false);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [form, id, resource]
    );

    return {
      id,
      isEdit: Boolean(id),
      form,
      setForm,
      change,
      setValue,
      submit,
      reset,
      loading,
      saving,
      error,
      setError,
      success,
    };
  };

  return { useCrud, useRecordForm };
};
