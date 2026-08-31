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
  name: "",
  code: "",
  description: "",
  client: "",
  teamLeader: "",
  status: "planning",
  priority: "medium",
  progress: 0,
  budget: 0,
  startDate: "",
  endDate: "",
};

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

export default function CreateProject() {
  const navigate = useNavigate();
  const lookups = useLookups();

  const { form, change, submit, isEdit, loading, saving, error, success } = useRecordForm(
    "projects",
    EMPTY,
    (item) => ({
      ...item,
      client: item.client?._id || "",
      teamLeader: item.teamLeader?._id || "",
      startDate: toDateInput(item.startDate),
      endDate: toDateInput(item.endDate),
    })
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      ...form,
      progress: Number(form.progress) || 0,
      budget: Number(form.budget) || 0,
    };

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate("/admin/projects"), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Project" : "Create Project"}
        subtitle={isEdit ? "Update scope, timeline and ownership" : "Set up a new project and assign its leader"}
      >
        <Button variant="outline" onClick={() => navigate("/admin/projects")}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-4xl">
        <Card>
          <CardHeader title="Project details" subtitle="Fields marked * are required" />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Project name" required>
                <Input name="name" value={form.name} onChange={change} required placeholder="Green Valley Township" />
              </Field>

              <Field label="Project code">
                <Input name="code" value={form.code} onChange={change} placeholder="PRJ-001" />
              </Field>

              <Field label="Client">
                <Select
                  name="client"
                  value={form.client}
                  onChange={change}
                  placeholder="Select client"
                  options={lookups.clientOptions}
                />
              </Field>

              <Field label="Team leader">
                <Select
                  name="teamLeader"
                  value={form.teamLeader}
                  onChange={change}
                  placeholder="Select team leader"
                  options={lookups.leaderOptions}
                />
              </Field>

              <Field label="Status">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={["planning", "in_progress", "on_hold", "completed", "cancelled"]}
                />
              </Field>

              <Field label="Priority">
                <Select name="priority" value={form.priority} onChange={change} options={["low", "medium", "high"]} />
              </Field>

              <Field label="Start date">
                <Input name="startDate" type="date" value={form.startDate} onChange={change} />
              </Field>

              <Field label="End date">
                <Input name="endDate" type="date" value={form.endDate} onChange={change} />
              </Field>

              <Field label="Budget (₹)">
                <Input name="budget" type="number" min="0" value={form.budget} onChange={change} placeholder="2500000" />
              </Field>

              <Field label="Progress (%)">
                <Input
                  name="progress"
                  type="number"
                  min="0"
                  max="100"
                  value={form.progress}
                  onChange={change}
                />
              </Field>

              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  name="description"
                  value={form.description}
                  onChange={change}
                  rows={4}
                  placeholder="Scope of work, key deliverables and approvals needed."
                />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => navigate("/admin/projects")}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save size={15} />
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
