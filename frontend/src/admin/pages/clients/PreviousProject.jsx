import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Search } from "lucide-react";

import adminApi from "../../adminApi";
import { Field, Select } from "../../../shared/components/ui";

/**
 * "Have we built something for them before?"
 *
 * Asked once, on the client, rather than on every project. The answer is
 * carried onto each project created for this client afterwards — see the
 * projects `beforeSave` in adminRoutes — which is what stops it being filled
 * in for the first job and forgotten by the third.
 *
 * Two scopes, and the fallback is the one that earns its keep: a returning
 * customer often comes back under a different client record — a new company
 * name, a new entity — and their old work sits under the old one. Defaulting
 * to this client's own projects keeps the common case to two clicks; widening
 * the search covers the case that would otherwise be impossible.
 */

const SCOPES = [
  { value: "own", label: "This client's projects" },
  { value: "all", label: "Search every project" },
];

export default function PreviousProject({ value, onChange }) {
  const [params] = useSearchParams();
  const clientId = params.get("id") || "";

  // "No" until somebody says otherwise — most clients are new
  const [related, setRelated] = useState(Boolean(value));
  const [scope, setScope] = useState("own");
  const [search, setSearch] = useState("");

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);

  /**
   * A brand new client has no projects of their own, so there is nothing for
   * the default scope to offer. Saying so and starting on the wider search
   * beats presenting an empty dropdown with no explanation.
   */
  const isNewClient = !clientId;

  useEffect(() => {
    if (isNewClient) setScope("all");
  }, [isNewClient]);

  useEffect(() => {
    if (!related) return undefined;

    let active = true;
    setLoading(true);

    adminApi
      .get("/admin/projects", {
        params: {
          limit: 200,
          ...(scope === "own" && clientId ? { client: clientId } : {}),
          ...(scope === "all" && search.trim() ? { search: search.trim() } : {}),
        },
      })
      .then(({ data }) => active && setProjects(data.items || []))
      .catch(() => active && setProjects([]))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [related, scope, search, clientId]);

  const options = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: [
          project.code,
          project.name,
          // Whose it was, which is the thing that disambiguates a wide search
          scope === "all" && project.client?.name ? `· ${project.client.name}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      })),
    [projects, scope]
  );

  const answer = (yes) => {
    setRelated(yes);
    // Answering "no" clears any selection, rather than leaving a hidden link
    if (!yes) onChange("");
  };

  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-inset ring-slate-200">
          <History size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            Is this project related to an app or website we built previously?
          </p>
          <p className="text-[11px] text-slate-500">
            Linking it means whoever picks the work up can see what was built before
          </p>

          <div className="mt-2.5 flex gap-2">
            {[
              [false, "No"],
              [true, "Yes"],
            ].map(([yes, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => answer(yes)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                  related === yes
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {related && (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Look in">
              <Select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setSearch("");
                }}
                options={
                  // A new client has none of their own to look in
                  isNewClient ? SCOPES.filter((s) => s.value === "all") : SCOPES
                }
              />
            </Field>

            {scope === "all" && (
              <Field label="Search" hint="By project name or code">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Skyline, ERP, WEB-02…"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </Field>
            )}
          </div>

          <Field
            label="Previous project"
            hint={
              isNewClient
                ? "A new client has no projects here yet — search every project to find their earlier work"
                : "Projects created for this client afterwards are linked to this one automatically"
            }
          >
            <Select
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              options={options}
              placeholder={
                loading
                  ? "Loading…"
                  : options.length
                    ? "Choose the earlier project"
                    : "No projects found"
              }
            />
          </Field>
        </div>
      )}
    </div>
  );
}
