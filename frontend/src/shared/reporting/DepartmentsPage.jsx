import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  FolderKanban,
  Handshake,
  IdCard,
  Landmark,
  Megaphone,
  Network,
  Plus,
  UserRound,
  Users,
  UserX,
} from "lucide-react";

import Modal from "../components/Modal";
import { prettify } from "../format";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

/**
 * Sales and Operations, side by side.
 *
 * The brief the panel is built to says the two are separate departments with
 * separate managers, teams and figures — so a single company-wide number is
 * exactly the thing that hides what somebody opened this page to find out.
 * Every figure here is per department, and the teams inside each are listed
 * with the manager who answers for them.
 *
 * The gaps get equal billing. A team with no manager and a person on no team
 * are both places where a report silently stops travelling, and the person who
 * would notice is the one who never receives it.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, index) => ({ value: index + 1, label }));

const YEARS = (() => {
  const now = new Date().getFullYear();
  return [now + 1, now, now - 1, now - 2].map((year) => ({ value: year, label: String(year) }));
})();

/**
 * What a department is for, which is what lets a target know whose numbers it
 * is measuring — a revenue target belongs to Sales, a delivery one to
 * Operations. Mirrors TEAM_KINDS in models/Team.js; a department that is none
 * of these is "other" and has its targets set by hand.
 */
const KINDS = [
  { value: "operations", label: "Operations — the delivery itself" },
  { value: "sales", label: "Sales — leads, quotations, collections" },
  { value: "hr", label: "HR — hiring, onboarding, attendance" },
  { value: "accounts", label: "Accounts — invoicing and books" },
  { value: "marketing", label: "Marketing — reach and campaigns" },
  { value: "other", label: "Other — targets set by hand" },
];

const BLANK_DEPARTMENT = { name: "", kind: "operations", description: "" };

/**
 * An icon and one accent colour per department.
 *
 * Kept inside the blue/black/grey palette the rest of the panel uses rather
 * than giving each department a colour of its own — six hues across two cards
 * reads as decoration, and the thing that should catch the eye here is a team
 * with no manager, not the heading above it.
 */
const KIND_META = {
  operations: { icon: FolderKanban, accent: "#2563EB" },
  sales: { icon: Handshake, accent: "#0F172A" },
  hr: { icon: IdCard, accent: "#60A5FA" },
  accounts: { icon: Landmark, accent: "#475569" },
  marketing: { icon: Megaphone, accent: "#93C5FD" },
  other: { icon: Building2, accent: "#94A3B8" },
};

const metaFor = (kind) => KIND_META[kind] || KIND_META.other;

function Meter({ value = 0, accent }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: accent }}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-500",
    blue: "bg-blue-50 text-blue-600",
    black: "bg-slate-900 text-white",
    red: "bg-red-50 text-red-600",
  };
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
        <p className="truncate text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      </div>
    </Card>
  );
}

/**
 * `managePath` turns the page from a report into a screen somebody works on.
 *
 * Left out, this is exactly what it was: a read-only view of the departments
 * and the gaps in the chain. Given a path, an "Add department" button appears
 * and posts to it. It is a prop rather than a role check because the two
 * panels that render this page reach the same Team records through different
 * doors, and neither of them should be named in here.
 */
export default function DepartmentsPage({ api, basePath, title, subtitle, managePath }) {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [data, setData] = useState(null);
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK_DEPARTMENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const changePeriod = useCallback((patch) => {
    setLoading(true);
    setPeriod((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      api.get(`${basePath}/departments`, { params: period }).then((r) => r.data),
      api.get(`${basePath}/org`).then((r) => r.data),
    ])
      .then(([perf, chart]) => {
        if (!active) return;
        setData(perf);
        setOrg(chart);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load this"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, period, reloadKey]);

  const changeForm = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  /**
   * A new department starts with no manager on purpose. Appointing one is a
   * separate decision made against a person, and the page already lists a
   * department with nobody answering for it under "Gaps in the chain" — so
   * the new one shows up there as the next thing to do rather than forcing
   * the choice before the department exists.
   */
  const createDepartment = async (e) => {
    e?.preventDefault();
    if (!managePath) return;

    setSaving(true);
    setFormError("");
    try {
      const { data: created } = await api.post(managePath, {
        name: form.name.trim(),
        kind: form.kind,
        description: form.description.trim(),
      });
      setNotice(`${created.item?.name || form.name} was added. It has no manager yet.`);
      setAdding(false);
      setForm(BLANK_DEPARTMENT);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add that department");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Loader label="Loading departments…" />;

  const gaps = org?.gaps || {};
  const gapCount =
    (gaps.noHrAccount ? 1 : 0) +
    (gaps.teamsWithoutManager?.length || 0) +
    (gaps.unattached?.length || 0);

  const periodLabel = `${MONTHS[period.month - 1].label} ${period.year}`;

  return (
    <div>
      <PageHeader
        title={title || "Departments"}
        subtitle={subtitle || "Each department, its teams and the numbers they carry"}
      >
        <Select
          value={period.month}
          onChange={(e) => changePeriod({ month: Number(e.target.value) })}
          options={MONTHS}
          className="w-auto"
        />
        <Select
          value={period.year}
          onChange={(e) => changePeriod({ year: Number(e.target.value) })}
          options={YEARS}
          className="w-auto"
        />
        {managePath && (
          <Button
            onClick={() => {
              setForm(BLANK_DEPARTMENT);
              setFormError("");
              setAdding(true);
            }}
          >
            <Plus size={15} /> Add department
          </Button>
        )}
      </PageHeader>

      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <Alert>{error}</Alert>

      {/* ------------------------------------------------------------ tiles */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Building2} label="Departments" value={data?.departments?.length ?? 0} />
        <Stat icon={Network} label="Teams" value={data?.totals?.teams ?? 0} tone="blue" />
        <Stat icon={Users} label="People" value={data?.totals?.headcount ?? 0} tone="black" />
        <Stat
          icon={AlertTriangle}
          label="Blockers raised"
          value={data?.totals?.blockers ?? 0}
          tone={data?.totals?.blockers ? "red" : "slate"}
        />
      </div>

      {/* ------------------------------------------------ where it is broken */}
      {gapCount > 0 && (
        <Card className="mb-4 border-red-200">
          <div className="flex items-center gap-2.5 border-b border-red-100 bg-red-50/60 px-4 py-3">
            <AlertTriangle size={16} className="shrink-0 text-red-600" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">
                Gaps in the chain
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                  {gapCount}
                </span>
              </h3>
              <p className="text-xs text-slate-500">A report cannot travel through a missing link</p>
            </div>
          </div>

          <ul className="divide-y divide-slate-100">
            {gaps.noHrAccount && (
              <li className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                <IdCard size={14} className="mt-0.5 shrink-0 text-red-500" />
                <span className="text-slate-700">
                  <span className="font-medium">There is no HR account</span> — no manager can send
                  a team update anywhere.
                </span>
              </li>
            )}

            {gaps.teamsWithoutManager?.map((name) => (
              <li key={name} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                <UserRound size={14} className="mt-0.5 shrink-0 text-red-500" />
                <span className="text-slate-700">
                  <span className="font-medium">{name}</span> has no manager — nobody answers for
                  its numbers, and its members have nobody to report to.
                </span>
              </li>
            ))}

            {gaps.unattached?.length > 0 && (
              <li className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                <UserX size={14} className="mt-0.5 shrink-0 text-red-500" />
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {gaps.unattached.length} on no team
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {gaps.unattached.map((person) => (
                      <span
                        key={person._id}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {person.name}
                      </span>
                    ))}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    They cannot file an update until somebody adds them to a team.
                  </p>
                </div>
              </li>
            )}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------- the departments */}
      {data?.departments?.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.departments.map((dept) => {
            const meta = metaFor(dept.department);
            const Icon = meta.icon;
            const unstaffed = dept.teams.filter((team) => !team.manager).length;

            return (
              <Card key={dept.department} className="overflow-hidden">
                {/* ------------------------------------------------ heading */}
                <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: meta.accent }}
                  >
                    <Icon size={18} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {prettify(dept.department)}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {dept.teams.length} team{dept.teams.length === 1 ? "" : "s"} ·{" "}
                      {dept.headcount} {dept.headcount === 1 ? "person" : "people"} · {periodLabel}
                    </p>
                  </div>

                  {unstaffed > 0 && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                      {unstaffed} unled
                    </span>
                  )}
                </div>

                {/* ------------------------------------------------- numbers */}
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        Tasks completed
                      </p>
                      <p className="text-lg font-semibold leading-tight tabular-nums text-slate-900">
                        {dept.completed}
                        <span className="text-sm font-normal text-slate-400">/{dept.tasks}</span>
                      </p>
                    </div>
                    <p
                      className="text-2xl font-bold leading-none tabular-nums"
                      style={{ color: meta.accent }}
                    >
                      {dept.completionRate}%
                    </p>
                  </div>

                  <div className="mt-2">
                    <Meter value={dept.completionRate} accent={meta.accent} />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      // What proportion of what was filed actually got an answer
                      // — the number that says whether the chain is working
                      ["Reports answered", `${dept.answerRate}%`, false],
                      ["Reports filed", dept.reportsFiled, false],
                      ["Blockers", dept.blockers, dept.blockers > 0],
                    ].map(([label, value, alarming]) => (
                      <div
                        key={label}
                        className={`rounded-lg px-2.5 py-2 ${
                          alarming ? "bg-red-50" : "bg-slate-50"
                        }`}
                      >
                        <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
                          {label}
                        </p>
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            alarming ? "text-red-700" : "text-slate-900"
                          }`}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* --------------------------------------------------- teams */}
                {dept.teams.length ? (
                  <ul className="divide-y divide-slate-100">
                    {dept.teams.map((team) => (
                      <li key={team._id} className="px-4 py-3 transition-colors hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {team.name}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs">
                              {team.manager ? (
                                <span className="text-slate-500">Led by {team.manager.name}</span>
                              ) : (
                                <span className="font-medium text-red-600">No manager</span>
                              )}
                              <span className="text-slate-300">·</span>
                              <span className="text-slate-400">{team.headcount} people</span>
                              {team.blockers > 0 && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-red-600">{team.blockers} blockers</span>
                                </>
                              )}
                            </p>
                          </div>

                          <div className="w-28 shrink-0">
                            <div className="flex items-baseline justify-between gap-1 text-[11px]">
                              <span className="tabular-nums text-slate-400">
                                {team.completed}/{team.tasks}
                              </span>
                              <span className="font-semibold tabular-nums text-slate-700">
                                {team.completionRate}%
                              </span>
                            </div>
                            <div className="mt-1">
                              <Meter value={team.completionRate} accent={meta.accent} />
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-center text-xs text-slate-400">
                    No teams under this department yet.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Building2}
            title="No departments yet"
            message="Create a team under Teams & Targets and give it a kind — Sales or Operations — and it appears here."
          />
        </Card>
      )}

      {/* --------------------------------------------------------- the chain */}
      {org && (
        <Card className="mt-4">
          <CardHeader
            title="The reporting chain"
            subtitle="Where an update goes after somebody files it"
            action={<Network size={15} className="text-slate-400" />}
          />

          <div className="overflow-x-auto px-4 py-4">
            <div className="flex min-w-max items-stretch gap-2">
              {[
                [
                  "Members",
                  `${org.departments?.reduce((sum, d) => sum + (d.headcount || 0), 0) || 0} across ${
                    org.departments?.length || 0
                  } teams`,
                  Users,
                ],
                [
                  "Managers",
                  org.departments
                    ?.map((d) => d.manager?.name)
                    .filter(Boolean)
                    .join(", "),
                  UserRound,
                ],
                ["HR", org.hr?.map((h) => h.name).join(", "), IdCard],
                ["Admin", org.admins?.map((a) => a.name).join(", "), Building2],
              ].map(([label, value, StepIcon], index, all) => (
                <div key={label} className="flex items-stretch gap-2">
                  <div className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                      <StepIcon size={12} />
                      {label}
                    </p>
                    <p className="mt-1 break-words text-sm text-slate-800">
                      {value || <span className="text-slate-400">nobody yet</span>}
                    </p>
                  </div>

                  {index < all.length - 1 && (
                    <span className="flex items-center text-slate-300">
                      <ArrowRight size={16} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------ a new department */}

      <Modal
        open={adding}
        title="Add a department"
        subtitle="It appears on the org chart and in targets straight away"
        onClose={() => setAdding(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={createDepartment} disabled={saving || !form.name.trim()}>
              {saving ? "Adding…" : "Add department"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={createDepartment}>
          {formError && <Alert>{formError}</Alert>}

          <Field label="Name" required>
            <Input
              name="name"
              value={form.name}
              onChange={changeForm}
              placeholder="Design"
              required
            />
          </Field>

          <Field
            label="What it does"
            hint="Decides which targets can be set against it automatically"
          >
            <Select name="kind" value={form.kind} onChange={changeForm} options={KINDS} />
          </Field>

          <Field label="Description" hint="Optional — what this department is responsible for">
            <Textarea name="description" rows={2} value={form.description} onChange={changeForm} />
          </Field>

          <p className="text-xs text-slate-500">
            No manager is set yet. The new department shows under “Gaps in the chain” until
            somebody is appointed to answer for it.
          </p>
        </form>
      </Modal>
    </div>
  );
}
