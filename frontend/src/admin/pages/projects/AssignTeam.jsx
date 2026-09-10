import { useEffect, useState } from "react";
import { Save, Users, Search, TriangleAlert } from "lucide-react";

import adminApi from "../../adminApi";
import useLookups from "../../hooks/useLookups";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Loader,
  PageHeader,
  ProgressBar,
  Select,
} from "../../../shared/components/ui";

export default function AssignTeam() {
  const lookups = useLookups();

  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [project, setProject] = useState(null);
  const [operationsManager, setOperationsManager] = useState("");
  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Project list for the left column
  useEffect(() => {
    adminApi
      .get("/admin/projects", { params: { limit: 200 } })
      .then(({ data }) => {
        setProjects(data.items || []);
        if (data.items?.length) setSelectedId(data.items[0]._id);
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load projects"))
      .finally(() => setLoading(false));
  }, []);

  // Load the selected project's current team
  useEffect(() => {
    if (!selectedId) return undefined;

    let active = true;

    adminApi
      .get(`/admin/projects/${selectedId}`)
      .then(({ data }) => {
        if (!active) return;
        setSuccess("");
        setProject(data.item);
        setOperationsManager(data.item.operationsManager?._id || "");
        setMembers((data.item.members || []).map((m) => m._id));
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the project");
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const toggleMember = (id) =>
    setMembers((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data } = await adminApi.put(`/admin/projects/${selectedId}`, {
        operationsManager,
        members,
      });
      setProject(data.item);
      setProjects((prev) => prev.map((p) => (p._id === data.item._id ? data.item : p)));
      setSuccess("Team assigned successfully");
    } catch (err) {
      setError(err.response?.data?.message || "Could not assign the team");
    } finally {
      setSaving(false);
    }
  };

  const filteredEmployees = lookups.employees.filter((emp) =>
    emp.name.toLowerCase().includes(query.toLowerCase())
  );

  /**
   * A leader may only hand work to people who report to them, so a member from
   * another leader's team would sit on the project unable to be given a task.
   */
  const reportsElsewhere = (emp) =>
    Boolean(operationsManager) && String(emp.reportsTo?._id || "") !== String(operationsManager);

  const strays = lookups.employees.filter(
    (emp) => members.includes(emp._id) && reportsElsewhere(emp)
  );

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader title="Assign Team" subtitle="Put a leader and members on each project">
        <Button loading={saving} onClick={handleSave} disabled={!selectedId}>
          <Save size={15} />
          Save team
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------- project list */}
        <Card className="lg:col-span-1">
          <CardHeader title="Projects" subtitle="Select one to edit its team" />
          <div className="max-h-[600px] overflow-y-auto">
            {projects.map((item) => (
              <button
                key={item._id}
                onClick={() => setSelectedId(item._id)}
                className={`flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-0 ${
                  selectedId === item._id ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">{item.name}</span>
                  <Badge value={item.status} />
                </div>
                <span className="text-xs text-slate-400">
                  {item.operationsManager?.name || "No leader"} · {item.members?.length || 0} members
                </span>
              </button>
            ))}
            {!projects.length && (
              <EmptyState icon={Users} title="No projects" message="Create a project first." />
            )}
          </div>
        </Card>

        {/* ------------------------------------------------ team assignment */}
        <Card className="lg:col-span-2">
          {!project ? (
            <EmptyState icon={Users} title="Select a project" message="Pick a project on the left." />
          ) : (
            <>
              <CardHeader
                title={project.name}
                subtitle={`${project.client?.company || project.client?.name || "No client"} · ${
                  project.code || "no code"
                }`}
              />

              <div className="space-y-4 p-5">
                <div className="rounded-lg bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                    <span>
                      Status: <Badge value={project.status} />
                    </span>
                    <span className="flex items-center gap-2">
                      Progress: <ProgressBar value={project.progress} />
                    </span>
                    <span>
                      Members selected:{" "}
                      <strong className="text-slate-800">{members.length}</strong>
                    </span>
                  </div>
                </div>

                <Field label="Operations Manager" className="max-w-md">
                  <Select
                    value={operationsManager}
                    onChange={(e) => setOperationsManager(e.target.value)}
                    placeholder="No operations manager"
                    options={lookups.leaderOptions}
                  />
                </Field>

                {strays.length > 0 && (
                  <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {strays.map((e) => e.name).join(", ")}{" "}
                      {strays.length === 1 ? "reports" : "report"} to another operations manager, so{" "}
                      {lookups.operationsManagers.find((l) => String(l._id) === String(operationsManager))?.name ||
                        "this leader"}{" "}
                      cannot assign them tasks. Change their "Reports to" under Employees, or pick
                      someone from this leader's team.
                    </span>
                  </p>
                )}

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-slate-700">
                      Team members
                      <span className="ml-1.5 font-normal text-slate-400">
                        {members.length} of {lookups.employees.length} selected
                      </span>
                    </label>
                    <div className="relative">
                      <Search
                        size={14}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter employees"
                        className="w-48 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                    {filteredEmployees.map((emp) => {
                      const checked = members.includes(emp._id);
                      const stray = checked && reportsElsewhere(emp);

                      return (
                        <label
                          key={emp._id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            stray
                              ? "border-amber-400 bg-amber-50"
                              : checked
                                ? "border-blue-600 bg-blue-50"
                                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(emp._id)}
                            className="h-4 w-4 accent-blue-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {emp.name}
                            </span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {emp.designation || "Employee"} ·{" "}
                              {emp.reportsTo?.name ? (
                                <span className={stray ? "text-amber-700" : ""}>
                                  reports to {emp.reportsTo.name}
                                </span>
                              ) : (
                                <span className="text-amber-700">no operations manager</span>
                              )}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {!filteredEmployees.length && (
                      <p className="col-span-full py-6 text-center text-xs text-slate-400">
                        {lookups.employees.length
                          ? `No employees match "${query}"`
                          : "No employees yet — add them under Employees first."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
