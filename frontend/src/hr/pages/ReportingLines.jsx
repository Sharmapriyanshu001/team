import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Users, UserRoundCog, UserX } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import Avatar from "../../shared/components/Avatar";
import Toolbar from "../../shared/components/Toolbar";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Loader,
  PageHeader,
  Select,
} from "../../shared/components/ui";

/**
 * Who works under whom, and the screen for changing it.
 *
 * The reporting line was editable in two places before this, and neither was
 * where somebody would go to do it: buried in step one of the hiring form, and
 * behind an icon on a row of the staff list. Both move one person. The thing
 * HR actually does is move several at once — a manager leaves, a team is split,
 * a new operations manager takes over half a department — and doing that one
 * row at a time is how reporting lines end up stale.
 *
 * So: everybody on the left, a manager on the right, and one button between
 * them. The write is a single request rather than one per person, because
 * nine requests are nine chances to half-succeed with no way to say which four
 * moved — see setReportingLine in the HR people controller.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * The line is not a label. It is who approves somebody's leave, whose report
 * their work rolls up into, and where they appear on the org chart. Somebody
 * under nobody is somebody whose leave request has no destination — which is
 * why "No manager" is drawn as a warning here rather than as a blank.
 */

/** Everybody HR can put under a manager. Managers themselves are the target. */
const ASSIGNABLE_ROLES = ["employee", "sales", "operations"];

export default function ReportingLines() {
  const { can } = useHrAccess();
  const canEdit = can("employees", "edit");

  const [people, setPeople] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  /** "" everybody · "none" nobody above them · an id, that manager's people */
  const [under, setUnder] = useState("");

  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.all([
      hrApi
        .get("/hr/employees", { params: { limit: 500 } })
        .then((r) => r.data.items || []),
      hrApi
        .get("/hr/operations-managers", { params: { limit: 200, status: "active" } })
        .then((r) => r.data.items || [])
        .catch(() => []),
    ])
      .then(([staff, leads]) => {
        if (!active) return;
        setPeople(staff);
        setManagers(leads);
        setError("");
      })
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load the team")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Only the people a reporting line is about.
   *
   * A manager has one of their own — they answer to the department head — but
   * moving managers around is a different decision from staffing a team, and
   * mixing the two on one screen makes it easy to do the first by accident.
   */
  const assignable = useMemo(
    () => people.filter((person) => ASSIGNABLE_ROLES.includes(person.role)),
    [people]
  );

  /** How many sit under each manager, for the counts beside their names. */
  const countUnder = useMemo(() => {
    const counts = {};
    assignable.forEach((person) => {
      const id = person.reportsTo?._id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [assignable]);

  const orphans = assignable.filter((person) => !person.reportsTo).length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return assignable.filter((person) => {
      if (under === "none" && person.reportsTo) return false;
      if (under && under !== "none" && person.reportsTo?._id !== under) return false;

      if (!term) return true;
      return [person.name, person.email, person.designation, person.department]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [assignable, search, under]);

  const allShown = visible.length > 0 && visible.every((p) => picked.includes(p._id));

  const toggle = (id) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id]
    );

  const toggleAll = () =>
    setPicked((current) =>
      allShown
        ? current.filter((id) => !visible.some((p) => p._id === id))
        : [...new Set([...current, ...visible.map((p) => p._id)])]
    );

  const apply = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await hrApi.put("/hr/employees/reporting-line", {
        employees: picked,
        reportsTo: target,
      });
      setNotice(data.message || "Saved");
      setPicked([]);
      setReloadKey((n) => n + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not change those reporting lines");
    } finally {
      setSaving(false);
    }
  };

  const managerOptions = managers.map((m) => ({
    value: m._id,
    label: m.designation ? `${m.name} — ${m.designation}` : m.name,
  }));

  if (loading) return <Loader label="Reading the reporting lines…" />;

  return (
    <div>
      <PageHeader
        title="Reporting Lines"
        subtitle="Who works under which manager — and how to move them"
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {/* ------------------------------------------------------ the counts */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Card className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Users size={12} /> People
          </p>
          <p className="mt-0.5 text-xl font-semibold text-slate-900">{assignable.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <UserRoundCog size={12} /> Managers
          </p>
          <p className="mt-0.5 text-xl font-semibold text-slate-900">{managers.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <UserX size={12} /> Under nobody
          </p>
          <p
            className={`mt-0.5 text-xl font-semibold ${
              orphans ? "text-amber-700" : "text-slate-900"
            }`}
          >
            {orphans}
          </p>
        </Card>
      </div>

      {orphans > 0 && under !== "none" && (
        <button
          type="button"
          onClick={() => setUnder("none")}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-50"
        >
          <AlertTriangle size={14} className="shrink-0" />
          {orphans} {orphans === 1 ? "person reports" : "people report"} to nobody — their leave
          has no one to approve it. Show them.
        </button>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-3">
        {/* ------------------------------------------------ who is where */}
        <Card className="lg:col-span-1">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Managers</p>
            <p className="text-xs text-slate-500">Click one to see their team</p>
          </div>

          <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => setUnder("")}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                  under === "" ? "bg-blue-50/60 font-medium text-blue-700" : "text-slate-700"
                }`}
              >
                Everybody
                <span className="text-xs text-slate-400">{assignable.length}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setUnder("none")}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                  under === "none" ? "bg-blue-50/60 font-medium text-blue-700" : "text-amber-700"
                }`}
              >
                Under nobody
                <span className="text-xs text-slate-400">{orphans}</span>
              </button>
            </li>

            {managers.map((manager) => (
              <li key={manager._id}>
                <button
                  type="button"
                  onClick={() => setUnder(manager._id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                    under === manager._id ? "bg-blue-50/60" : ""
                  }`}
                >
                  <Avatar name={manager.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {manager.name}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {manager.designation || "Operations Manager"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {countUnder[manager._id] || 0}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* --------------------------------------------------- the people */}
        <Card className="lg:col-span-2">
          <Toolbar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search a name, a designation or a department"
          />

          {/**
           * The bar only exists once something is selected.
           *
           * A disabled "Move" button sitting above an untouched list is a
           * control asking to be understood before it can be ignored; this
           * appears as the answer to something somebody just did.
           */}
          {canEdit && picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-4 py-2.5">
              <span className="text-sm font-medium text-blue-900">
                {picked.length} selected
              </span>
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-auto min-w-[220px]"
                options={[
                  { value: "", label: "Nobody — take them off their manager" },
                  ...managerOptions,
                ]}
                disabled={saving}
              />
              <Button onClick={apply} disabled={saving}>
                {saving ? "Moving…" : "Move them"}
              </Button>
              <Button variant="ghost" onClick={() => setPicked([])} disabled={saving}>
                Clear
              </Button>
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search ? "Nobody matches that" : "Nobody here"}
              message={
                search
                  ? "Try a shorter search, or clear it."
                  : under === "none"
                    ? "Everybody is under a manager."
                    : "Nobody reports to this manager yet."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    {canEdit && (
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={allShown}
                          onChange={toggleAll}
                          aria-label="Select everybody shown"
                          className="h-4 w-4 accent-blue-600"
                        />
                      </th>
                    )}
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Person
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Department
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Reports to
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((person) => (
                    <tr
                      key={person._id}
                      onClick={canEdit ? () => toggle(person._id) : undefined}
                      className={`border-b border-slate-100 last:border-0 transition-colors ${
                        canEdit ? "cursor-pointer hover:bg-slate-50" : ""
                      } ${picked.includes(person._id) ? "bg-blue-50/40" : ""}`}
                    >
                      {canEdit && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={picked.includes(person._id)}
                            onChange={() => toggle(person._id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${person.name}`}
                            className="h-4 w-4 accent-blue-600"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={person.name} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{person.name}</p>
                            <p className="truncate text-xs text-slate-400">
                              {person.designation || (person.role || "").replace(/_/g, " ")}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {person.department ? (
                          <Badge tone="slate">{person.department}</Badge>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {person.reportsTo ? (
                          <span className="text-slate-700">{person.reportsTo.name}</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-700">Nobody</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
