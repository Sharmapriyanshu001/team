import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import adminApi from "../adminApi";
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
} from "../../shared/components/ui";

const EMPTY = {
  companyName: "",
  companyEmail: "",
  companyPhone: "",
  address: "",
  website: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  workingHours: "",
  emailNotifications: true,
  taskReminders: true,
  leaderClientChat: true,
  employeeClientChat: false,
};

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600"
      />
    </label>
  );
}

export default function Settings() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    adminApi
      .get("/admin/settings")
      .then(({ data }) => setForm({ ...EMPTY, ...data.settings }))
      .catch((err) => setError(err.response?.data?.message || "Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

  const change = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data } = await adminApi.put("/admin/settings", form);
      setForm({ ...EMPTY, ...data.settings });
      setSuccess("Settings saved successfully");
    } catch (err) {
      setError(err.response?.data?.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Company details and panel preferences" />

      <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
        <Alert>{error}</Alert>
        <Alert tone="success">{success}</Alert>

        <Card>
          <CardHeader title="Company profile" subtitle="Shown on reports and documents" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Company name">
              <Input name="companyName" value={form.companyName} onChange={change} />
            </Field>

            <Field label="Website">
              <Input name="website" value={form.website} onChange={change} placeholder="https://" />
            </Field>

            <Field label="Email">
              <Input name="companyEmail" type="email" value={form.companyEmail} onChange={change} />
            </Field>

            <Field label="Phone">
              <Input name="companyPhone" value={form.companyPhone} onChange={change} />
            </Field>

            <Field label="Address" className="sm:col-span-2">
              <Input name="address" value={form.address} onChange={change} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Regional" subtitle="Currency, timezone and office hours" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <Field label="Currency">
              <Select
                name="currency"
                value={form.currency}
                onChange={change}
                options={["INR", "USD", "EUR", "GBP", "AED"]}
              />
            </Field>

            <Field label="Timezone">
              <Select
                name="timezone"
                value={form.timezone}
                onChange={change}
                options={["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York"]}
              />
            </Field>

            <Field label="Working hours">
              <Input
                name="workingHours"
                value={form.workingHours}
                onChange={change}
                placeholder="09:30 - 18:30"
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications" subtitle="What the panel sends out automatically" />
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            <Toggle
              label="Email notifications"
              hint="Send updates when projects and tasks change"
              checked={form.emailNotifications}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, emailNotifications: e.target.checked }))
              }
            />
            <Toggle
              label="Task reminders"
              hint="Remind assignees before a task is due"
              checked={form.taskReminders}
              onChange={(e) => setForm((prev) => ({ ...prev, taskReminders: e.target.checked }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Staff panels"
            subtitle="What operations managers and employees can reach from their own logins"
          />
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            <Toggle
              label="Client chat for operations managers"
              hint="Adds a Client tab to the leader's Chat section for clients on their projects"
              checked={form.leaderClientChat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, leaderClientChat: e.target.checked }))
              }
            />
            <Toggle
              label="Client chat for employees"
              hint="Lets employees message clients on the projects they work on"
              checked={form.employeeClientChat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, employeeClientChat: e.target.checked }))
              }
            />
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            <Save size={15} />
            Save settings
          </Button>
        </div>
      </form>
    </div>
  );
}
