import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  IdCard,
  Network,
  Plus,
  ShieldCheck,
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
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

/**
 * One person on the chart.
 *
 * The role is shown beside the name rather than inferred from where the node
 * sits, because the two disagree more often than anybody expects — an
 * operations manager on nobody's team is still an operations manager, and the
 * chart that quietly relabels them as an employee is the chart that hides it.
 */
function Person({ name, role, tone = "slate" }) {
  const tones = {
    slate: "bg-white text-slate-800 ring-slate-200",
    blue: "bg-blue-50 text-blue-800 ring-blue-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
  };

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${tones[tone]}`}
    >
      <span className="truncate font-medium">{name}</span>
      {role && <span className="shrink-0 opacity-60">{prettify(role)}</span>}
    </span>
  );
}

/**
 * One rung of the chart, and everything hanging off it.
 *
 * Drawn as nested lists with a border down the left rather than as boxes and
 * arrows: the chain is read top to bottom, it has to survive a phone, and an
 * indent is the one connector that never needs measuring.
 */
function Node({ icon: Icon, label, meta, tone = "slate", warn, children }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    dark: "bg-slate-900 text-white",
    blue: "bg-blue-100 text-blue-700",
    violet: "bg-violet-100 text-violet-700",
    red: "bg-red-100 text-red-600",
  };

  return (
    <li className="relative pl-6 before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-slate-200 last:before:h-4">
      {/* The elbow into this node */}
      <span className="absolute left-0 top-4 h-px w-4 bg-slate-200" />

      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon size={14} />
        </span>
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        {meta && <span className="text-[11px] text-slate-400">{meta}</span>}
        {warn && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
            <AlertTriangle size={11} />
            {warn}
          </span>
        )}
      </div>

      {children && <ul className="ml-3.5">{children}</ul>}
    </li>
  );
}

/** The names on one rung, wrapped rather than scrolled. */
function People({ label, people, tone }) {
  if (!people?.length) return null;

  return (
    <li className="relative pl-6 before:absolute before:left-0 before:top-0 before:h-4 before:w-px before:bg-slate-200">
      <span className="absolute left-0 top-4 h-px w-4 bg-slate-200" />
      <div className="py-1.5">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
          {label} · {people.length}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <Person key={person._id} name={person.name} role={person.role} tone={tone} />
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * The whole company as one chart: who answers to whom, all the way down.
 *
 * Built from the org response alone — every team carries its `kind`, which is
 * what a department is here, so the grouping does not need a second request
 * that could disagree with this one.
 *
 * Teams and people that sit outside the chain are drawn as their own branch
 * rather than left off. A chart that only shows the parts that are wired up
 * correctly is a chart that cannot be used to find what is not.
 */
function OrgTree({ org }) {
  const teams = org?.departments || [];

  const byDepartment = teams.reduce((acc, team) => {
    const key = team.kind || "other";
    (acc[key] = acc[key] || []).push(team);
    return acc;
  }, {});

  const unattached = org?.gaps?.unattached || [];
  /**
   * People with a manager but no team. Not a gap — the chain reaches them —
   * but they belong on the chart, and before the server sent this branch a
   * reporting-line change made them disappear from it altogether.
   */
  const underManagers = org?.underManagers || [];

  return (
    <div className="px-4 py-4">
      <ul>
        <Node
          icon={ShieldCheck}
          label="Admin"
          tone="dark"
          meta={org?.admins?.map((a) => a.name).join(", ") || "nobody yet"}
        >
          <Node
            icon={IdCard}
            label="HR"
            tone="violet"
            meta={`${org?.hr?.length || 0} account${org?.hr?.length === 1 ? "" : "s"}`}
            warn={org?.gaps?.noHrAccount ? "no HR account" : ""}
          >
            <People label="HR" people={org?.hr} tone="violet" />

            {Object.entries(byDepartment).map(([kind, list]) => (
              <Node
                key={kind}
                icon={Building2}
                label={prettify(kind)}
                tone="blue"
                meta={`${list.length} team${list.length === 1 ? "" : "s"} · ${list.reduce(
                  (sum, t) => sum + (t.headcount || 0),
                  0
                )} people`}
              >
                {list.map((team) => (
                  <Node
                    key={team._id}
                    icon={Users}
                    label={team.name}
                    meta={`${team.headcount || 0} people`}
                    warn={team.manager ? "" : "no manager"}
                  >
                    {team.manager && (
                      <People label="Manager" people={[team.manager]} tone="blue" />
                    )}
                    <People
                      label="Operations managers"
                      people={team.operationsManagers}
                      tone="amber"
                    />
                    <People label="Members" people={team.members} tone="slate" />
                  </Node>
                ))}
              </Node>
            ))}

            {!teams.length && (
              <li className="relative pl-6 before:absolute before:left-0 before:top-0 before:h-4 before:w-px before:bg-slate-200">
                <span className="absolute left-0 top-4 h-px w-4 bg-slate-200" />
                <p className="py-2 text-sm text-slate-400">No teams yet.</p>
              </li>
            )}
          </Node>
        </Node>

        {/* Reporting to somebody, on nobody's team. Setting a reporting line
            and adding somebody to a team are two separate acts, so this is an
            ordinary state rather than a mistake — it is drawn under the
            manager who answers for them. */}
        {underManagers.length > 0 && (
          <Node
            icon={UserRound}
            label="Reporting in, not on a team"
            tone="slate"
            meta={`${underManagers.reduce((sum, g) => sum + g.people.length, 0)} people`}
          >
            {underManagers.map((group) => (
              <Node
                key={group.manager._id}
                icon={UserRound}
                label={group.manager.name}
                tone="blue"
                meta={prettify(group.manager.role)}
              >
                <People label="Reports" people={group.people} tone="slate" />
              </Node>
            ))}
          </Node>
        )}

        {/* Outside the chain entirely — drawn, because this is the branch
            somebody opened the chart to find */}
        {unattached.length > 0 && (
          <Node
            icon={UserX}
            label="Outside the chain"
            tone="red"
            meta="on no team, reporting to nobody"
            warn={`${unattached.length}`}
          >
            <People label="Nobody above them" people={unattached} tone="red" />
          </Node>
        )}
      </ul>
    </div>
  );
}

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
 * `managePath` turns the page from a report into a screen somebody works on.
 *
 * Left out, this is exactly what it was: a read-only view of the departments
 * and the gaps in the chain. Given a path, an "Add department" button appears
 * and posts to it. It is a prop rather than a role check because the two
 * panels that render this page reach the same Team records through different
 * doors, and neither of them should be named in here.
 */
export default function DepartmentsPage({ api, basePath, title, subtitle, managePath }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK_DEPARTMENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  /**
   * Only the chart is read now.
   *
   * /departments carried the month's completion rates and blocker counts for
   * the cards above the tree; with those gone it was a second request whose
   * answer nothing rendered.
   */
  useEffect(() => {
    let active = true;

    api
      .get(`${basePath}/org`)
      .then(({ data }) => active && setOrg(data))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load this"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, reloadKey]);

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

  if (loading && !org) return <Loader label="Loading departments…" />;

  return (
    <div>
      <PageHeader
        title={title || "Departments"}
        subtitle={subtitle || "Every department, its teams and who answers to whom"}
      >
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

      {/* --------------------------------------------------------- the chain */}
      {org && (
        <Card>
          <CardHeader
            title="The reporting chain"
            subtitle="Every department, its teams and everybody in them — and who they answer to"
            action={<Network size={15} className="text-slate-400" />}
          />

          <OrgTree org={org} />
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
