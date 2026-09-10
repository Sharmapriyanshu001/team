import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Crown, Plus, Target as TargetIcon, Trash2 } from "lucide-react";

import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  Select,
} from "../../../shared/components/ui";
import Progress from "./Progress";
import { formatValue, monthOptions, yearOptions } from "./constants";

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

export default function TeamDetail() {
  const { id } = useParams();
  const now = new Date();

  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [setting, setSetting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [doomed, setDoomed] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const changePeriod = useCallback((patch) => {
    setLoading(true);
    setPeriod((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    adminApi
      .get(`/admin/teams/${id}/detail`, { params: period })
      .then(({ data: payload }) => {
        if (!active) return;
        setData(payload);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load this team");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [id, period, reloadKey]);

  useEffect(() => {
    adminApi
      .get("/admin/teams/metrics")
      .then(({ data: payload }) => setMetrics(payload.metrics || []))
      .catch(() => setMetrics([]));
  }, []);

  const refresh = () => setReloadKey((key) => key + 1);

  const openTargetForm = (owner = null) =>
    setSetting({
      owner: owner?._id || "",
      ownerName: owner?.name || "",
      metric: "",
      customLabel: "",
      targetValue: "",
      manualValue: "",
    });

  const saveTarget = async () => {
    setSaving(true);
    setFormError("");
    try {
      await adminApi.post("/admin/targets", {
        team: id,
        owner: setting.owner || null,
        metric: setting.metric,
        customLabel: setting.customLabel,
        targetValue: Number(setting.targetValue),
        manualValue: Number(setting.manualValue) || 0,
        ...period,
      });
      setSetting(null);
      refresh();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not set that target");
    } finally {
      setSaving(false);
    }
  };

  const updateManual = async (target, value) => {
    try {
      await adminApi.put(`/admin/targets/${target._id}`, { manualValue: Number(value) || 0 });
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update that");
    }
  };

  if (loading && !data) return <Loader label="Loading team…" />;
  if (!data) return <Alert>{error || "Team not found"}</Alert>;

  const team = data.item;
  const chosen = metrics.find((metric) => metric.key === setting?.metric);

  /** Metrics that suit this team are offered first, but none are hidden. */
  const metricOptions = [...metrics]
    .sort((a, b) => {
      const fit = (metric) => (metric.team === team.kind ? 0 : metric.team === "other" ? 2 : 1);
      return fit(a) - fit(b);
    })
    .map((metric) => ({
      value: metric.key,
      label: `${metric.label}${metric.auto ? "" : " (entered by hand)"}`,
    }));

  return (
    <div>
      <Link
        to="/admin/teams"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        All teams
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{team.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {team.manager ? (
              <span className="inline-flex items-center gap-1">
                <Crown size={13} className="text-amber-500" />
                {team.manager.name}
                {team.manager.designation && ` · ${team.manager.designation}`}
              </span>
            ) : (
              <span className="text-amber-700">No manager — nobody answers for these numbers</span>
            )}
          </p>
          {team.description && (
            <p className="mt-1 max-w-lg text-xs text-slate-400">{team.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Month">
            <Select
              value={period.month}
              onChange={(e) => changePeriod({ month: Number(e.target.value) })}
              options={monthOptions()}
            />
          </Field>
          <Field label="Year">
            <Select
              value={period.year}
              onChange={(e) => changePeriod({ year: Number(e.target.value) })}
              options={yearOptions()}
            />
          </Field>
          <Button onClick={() => openTargetForm()}>
            <TargetIcon size={15} />
            Set a target
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="The team's targets"
              subtitle="What the whole team is carrying this month"
            />
            <div className="px-4 py-4">
              {data.targets.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">
                  Nothing set for this month.
                </p>
              ) : (
                <div className="space-y-4">
                  {data.targets.map((target) => (
                    <div key={target._id}>
                      <Progress target={target} />

                      <div className="mt-2 flex items-center gap-2">
                        {!target.auto && (
                          <Input
                            type="number"
                            min="0"
                            defaultValue={target.actual}
                            onBlur={(e) => updateManual(target, e.target.value)}
                            className="h-7 w-24 text-xs"
                            title="Type where this number actually is"
                          />
                        )}
                        <button
                          onClick={() => setDoomed(target)}
                          className="ml-auto rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Work in hand"
              subtitle={`${data.work.completedThisMonth} finished this month`}
            />
            {data.work.tasks.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing outstanding.</p>
            ) : (
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {data.work.tasks.map((task) => (
                  <div key={task._id} className="px-4 py-2.5 text-sm">
                    <p className="font-medium text-slate-900">{task.title}</p>
                    <p className="text-xs text-slate-400">
                      {task.assignedTo?.name || "unassigned"}
                      {task.project?.name && ` · ${task.project.name}`}
                      {task.dueDate && ` · due ${day(task.dueDate)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="People"
              subtitle="What each of them is carrying, and how it is going"
            />

            {data.people.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Nobody on this team yet. Add them from the Teams screen.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.people.map((person) => (
                  <div key={person._id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">
                          {person.name}
                          {person.isLeader && (
                            <span className="ml-2 inline-block align-middle">
                              <Badge value="operations manager" />
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {person.designation || "—"} · {person.openTasks} open task
                          {person.openTasks === 1 ? "" : "s"}
                        </p>
                      </div>

                      <Button size="sm" variant="outline" onClick={() => openTargetForm(person)}>
                        <Plus size={13} />
                        Target
                      </Button>
                    </div>

                    {person.targets.length > 0 && (
                      <div className="mt-3 space-y-4 border-l-2 border-slate-100 pl-3">
                        {person.targets.map((target) => (
                          <div key={target._id}>
                            <Progress target={target} />
                            {!target.auto && (
                              <Input
                                type="number"
                                min="0"
                                defaultValue={target.actual}
                                onBlur={(e) => updateManual(target, e.target.value)}
                                className="mt-1.5 h-7 w-24 text-xs"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(setting)}
        title={setting?.ownerName ? `Target for ${setting.ownerName}` : `Target for ${team.name}`}
        subtitle="One number, for one month"
        size="sm"
        onClose={() => setSetting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSetting(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveTarget}
              loading={saving}
              disabled={!setting?.metric || !setting?.targetValue}
            >
              Set target
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        {setting && (
          <div className="space-y-4">
            <Field label="What is being measured" required>
              <Select
                value={setting.metric}
                onChange={(e) => setSetting((s) => ({ ...s, metric: e.target.value }))}
                options={metricOptions}
                placeholder="Pick a number"
              />
            </Field>

            {chosen && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {chosen.auto
                  ? "This one counts itself from what is already in the panel — nobody has to total it up."
                  : "Nothing in the panel counts this, so somebody types where it has got to."}
              </p>
            )}

            {setting.metric === "custom" && (
              <Field label="What is this number" required>
                <Input
                  value={setting.customLabel}
                  onChange={(e) => setSetting((s) => ({ ...s, customLabel: e.target.value }))}
                  placeholder="e.g. Client reviews collected"
                />
              </Field>
            )}

            <Field
              label="Aim for"
              required
              hint={chosen?.unit === "currency" ? "In rupees" : chosen?.unit === "percent" ? "A percentage" : "A count"}
            >
              <Input
                type="number"
                min="1"
                value={setting.targetValue}
                onChange={(e) => setSetting((s) => ({ ...s, targetValue: e.target.value }))}
              />
            </Field>

            {chosen && !chosen.auto && (
              <Field label="Where it is now" hint="Can be updated any time">
                <Input
                  type="number"
                  min="0"
                  value={setting.manualValue}
                  onChange={(e) => setSetting((s) => ({ ...s, manualValue: e.target.value }))}
                />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(doomed)}
        title="Remove this target?"
        message={`${doomed?.label} — ${formatValue(doomed?.targetValue, doomed?.unit)} will no longer be tracked for this month.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await adminApi.delete(`/admin/targets/${doomed._id}`);
          setDoomed(null);
          refresh();
        }}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
