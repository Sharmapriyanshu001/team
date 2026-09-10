import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Users } from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loader,
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import Progress from "./Progress";
import { TEAM_KINDS, monthOptions, yearOptions } from "./constants";

const BLANK = {
  name: "",
  kind: "operations",
  description: "",
  manager: "",
  operationsManagers: [],
  members: [],
};

export default function Teams() {
  const navigate = useNavigate();
  const lookups = useLookups();

  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [reloadKey, setReloadKey] = useState(0);

  const changePeriod = useCallback((patch) => {
    setLoading(true);
    setPeriod((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/teams/overview", { params: period })
      .then(({ data: payload }) => {
        if (!active) return;
        setData(payload);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the teams");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [period, reloadKey]);

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, manager: form.manager || null };
      if (editing?._id) await adminApi.put(`/admin/teams/${editing._id}`, payload);
      else await adminApi.post("/admin/teams", payload);
      setEditing(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this team");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Loader label="Loading teams…" />;

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Who is in each department, who runs it, and how its numbers are going"
      >
        <Button
          onClick={() => {
            setEditing(BLANK);
            setForm(BLANK);
            setFormError("");
          }}
        >
          <Plus size={15} />
          New team
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-2">
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
      </div>

      <Alert>{error}</Alert>

      {!data?.teams?.length ? (
        <Card>
          <div className="px-6 py-12 text-center">
            <Users size={28} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">No teams yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
              Most studios run three: HR, Sales and Operations. Each gets one manager who answers
              for its numbers, operations managers who run the day to day, and the people doing the work.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.teams.map((team) => (
            <Card key={team._id}>
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      onClick={() => navigate(`/admin/teams/${team._id}`)}
                      className="text-left font-medium text-slate-900 hover:text-blue-600"
                    >
                      {team.name}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {team.manager?.name ? `Run by ${team.manager.name}` : "No manager set"} ·{" "}
                      {team.headcount} {team.headcount === 1 ? "person" : "people"}
                    </p>
                  </div>
                  <Badge value={team.kind} />
                </div>
              </div>

              <div className="px-4 py-3">
                {team.targets.length === 0 ? (
                  <p className="py-2 text-sm text-slate-400">
                    No targets set for this month.{" "}
                    <button
                      onClick={() => navigate(`/admin/teams/${team._id}`)}
                      className="text-blue-600 hover:underline"
                    >
                      Set one
                    </button>
                  </p>
                ) : (
                  <div className="space-y-3">
                    {team.targets.map((target) => (
                      <Progress key={target._id} target={target} />
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                  <span>
                    {team.work.open} open task{team.work.open === 1 ? "" : "s"} ·{" "}
                    {team.work.completedThisMonth} done this month
                  </span>
                  {team.behind > 0 && (
                    <span className="font-medium text-amber-700">
                      {team.behind} target{team.behind === 1 ? "" : "s"} behind
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? editing.name : "New team"}
        subtitle="One manager answers for the numbers; leaders run the day to day"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sales"
            />
          </Field>

          <Field label="What kind" hint="Decides which numbers it can count automatically">
            <Select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              options={TEAM_KINDS}
            />
          </Field>

          <Field
            label="Manager"
            className="sm:col-span-2"
            hint="Answers for this team's targets. They get the manager role and see the whole department in their panel."
          >
            <Select
              value={form.manager}
              onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))}
              options={lookups.staffOptions}
              placeholder="Nobody yet"
            />
          </Field>

          <Field
            label="Operations Managers"
            className="sm:col-span-2"
            hint="They run the day to day. Being added here makes an employee an operations manager."
          >
            <MultiSelect
              options={lookups.staffOptions}
              value={form.operationsManagers}
              onChange={(value) => setForm((f) => ({ ...f, operationsManagers: value }))}
              placeholder="Search staff…"
              emptyLabel="Nobody on record"
            />
          </Field>

          <Field label="Members" className="sm:col-span-2">
            <MultiSelect
              options={lookups.staffOptions}
              value={form.members}
              onChange={(value) => setForm((f) => ({ ...f, members: value }))}
              placeholder="Search staff…"
              emptyLabel="Nobody on record"
            />
          </Field>

          <Field label="What this team does" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
