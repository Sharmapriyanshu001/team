import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";

import { useRecordForm } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
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
} from "../../../shared/components/ui";

const EMPTY = {
  title: "",
  description: "",
  project: "",
  team: "",
  assignedTo: "",
  status: "pending",
  priority: "medium",
  /**
   * When it should start, beside when it should end.
   *
   * A due date on its own says when somebody is late; it does not say when
   * they were meant to pick the job up. Two tasks due Friday, one of them a
   * week's work, read identically without this.
   */
  startDate: "",
  dueDate: "",
  /** How far along, as the person doing it reports it. */
  progress: 0,
  /** Money on this particular job, earned when the work is accepted. */
  bonus: "",
};

/**
 * What a task hangs off.
 *
 * A project, as it always has — or, for somebody who runs a department, the
 * department itself. Hiring, collections and proposals are real work with a
 * real owner and no client project, and before this there was nowhere to file
 * any of it.
 */
const BELONGS_TO = [
  { value: "project", label: "A project" },
  { value: "team", label: "My department" },
];

export default function CreateTask() {
  const navigate = useNavigate();
  const lookups = useLookups();

  const { form, change, setForm, submit, isEdit, loading, saving, error, success } = useRecordForm(
    "tasks",
    EMPTY,
    (item) => ({
      ...item,
      project: item.project?._id || "",
      team: item.team?._id || "",
      assignedTo: item.assignedTo?._id || "",
      startDate: item.startDate ? new Date(item.startDate).toISOString().slice(0, 10) : "",
      dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : "",
      progress: item.progress ?? 0,
      // Blank rather than 0, so an untouched box does not read as "no bonus"
      bonus: item.bonus ? String(item.bonus) : "",
    })
  );

  // An existing task shows the kind it already is; a new one starts on a
  // project, which is what nearly all of them are.
  const belongsTo = form.team && !form.project ? "team" : "project";

  const changeBelongsTo = (e) =>
    setForm((current) => ({
      ...current,
      ...(e.target.value === "team" ? { project: "" } : { team: "" }),
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = { ...form };
    if (!payload.assignedTo) delete payload.assignedTo;
    if (!payload.dueDate) delete payload.dueDate;
    if (!payload.startDate) delete payload.startDate;

    /**
     * An empty bonus box means "no bonus", which is zero — sent explicitly so
     * clearing one actually clears it, rather than the field being dropped and
     * the old amount surviving the edit.
     */
    payload.bonus = Number(payload.bonus) || 0;
    payload.progress = Number(payload.progress) || 0;
    // Only one of the two travels, so an edit that moves a task between them
    // clears the side it left rather than keeping both links
    if (belongsTo === "team") payload.project = null;
    else payload.team = null;

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate("/operation-manager/tasks/assigned"), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Task" : "Create Task"}
        subtitle={
          lookups.managesDepartment
            ? "Assign work against one of your projects, or to your department"
            : "Assign work to your team against one of your projects"
        }
      >
        <Button variant="outline" onClick={() => navigate("/operation-manager/tasks/assigned")}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <Card>
          <CardHeader title="Task details" subtitle="Fields marked * are required" />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Title" required className="sm:col-span-2">
                <Input
                  name="title"
                  value={form.title}
                  onChange={change}
                  required
                  placeholder="Prepare structural drawings"
                />
              </Field>

              {lookups.managesDepartment && (
                <Field label="This work is for" className="sm:col-span-2">
                  <Select value={belongsTo} onChange={changeBelongsTo} options={BELONGS_TO} />
                </Field>
              )}

              {belongsTo === "team" ? (
                <Field label="Department" required>
                  <Select
                    name="team"
                    value={form.team}
                    onChange={change}
                    required
                    placeholder="Select a department you run"
                    options={lookups.departmentOptions}
                  />
                </Field>
              ) : (
                <Field label="Project" required>
                  <Select
                    name="project"
                    value={form.project}
                    onChange={change}
                    required
                    placeholder="Select one of your projects"
                    options={lookups.projectOptions}
                  />
                </Field>
              )}

              <Field label="Assign to" hint="Your team and the people reporting to you">
                <Select
                  name="assignedTo"
                  value={form.assignedTo}
                  onChange={change}
                  placeholder="Leave unassigned"
                  options={lookups.teamOptions}
                />
              </Field>

              <Field label="Priority">
                <Select
                  name="priority"
                  value={form.priority}
                  onChange={change}
                  options={["low", "medium", "high"]}
                />
              </Field>

              <Field label="Start date" hint="When they should pick it up">
                <Input name="startDate" type="date" value={form.startDate} onChange={change} />
              </Field>

              <Field label="Due date">
                <Input name="dueDate" type="date" value={form.dueDate} onChange={change} />
              </Field>

              <Field
                label="Bonus"
                hint="Earned when you approve the work. Blank means none."
              >
                <Input
                  name="bonus"
                  type="number"
                  min={0}
                  step={100}
                  value={form.bonus}
                  onChange={change}
                  placeholder="0"
                />
              </Field>

              <Field
                label="Progress"
                hint="Usually left at 0 — the person doing it reports this"
              >
                <div className="flex items-center gap-3">
                  <input
                    name="progress"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={form.progress}
                    onChange={change}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
                  />
                  <span className="w-10 text-right text-sm font-medium text-slate-700">
                    {form.progress}%
                  </span>
                </div>
              </Field>

              <Field label="Status" className="sm:col-span-2">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={["pending", "in_progress", "review", "completed"]}
                />
              </Field>

              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  name="description"
                  value={form.description}
                  onChange={change}
                  rows={4}
                  placeholder="What exactly needs doing, and what does done look like?"
                />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => navigate("/operation-manager/tasks/assigned")}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save size={15} />
              {isEdit ? "Save changes" : "Create task"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
