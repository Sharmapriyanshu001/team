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
  assignedTo: "",
  status: "pending",
  priority: "medium",
  dueDate: "",
};

export default function CreateTask() {
  const navigate = useNavigate();
  const lookups = useLookups();

  const { form, change, submit, isEdit, loading, saving, error, success } = useRecordForm(
    "tasks",
    EMPTY,
    (item) => ({
      ...item,
      project: item.project?._id || "",
      assignedTo: item.assignedTo?._id || "",
      dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : "",
    })
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = { ...form };
    if (!payload.assignedTo) delete payload.assignedTo;
    if (!payload.dueDate) delete payload.dueDate;

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate("/team-leader/tasks/assigned"), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Task" : "Create Task"}
        subtitle="Assign work to your team against one of your projects"
      >
        <Button variant="outline" onClick={() => navigate("/team-leader/tasks/assigned")}>
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

              <Field label="Assign to" hint="Only people reporting to you are listed">
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

              <Field label="Due date">
                <Input name="dueDate" type="date" value={form.dueDate} onChange={change} />
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
            <Button type="button" variant="outline" onClick={() => navigate("/team-leader/tasks/assigned")}>
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
