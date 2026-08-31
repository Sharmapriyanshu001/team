import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";

import { useRecordForm } from "../../hooks/crud";
import LoginCredentials from "../../components/LoginCredentials";
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
  company: "",
  email: "",
  phone: "",
  address: "",
  gstNumber: "",
  status: "active",
  notes: "",
  password: "",
  portalAccess: true,
};

export default function AddClient() {
  const navigate = useNavigate();
  const { form, change, submit, isEdit, loading, saving, error, success } =
    useRecordForm("clients", EMPTY);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // An empty password means "leave it as it is"
    const payload = { ...form };
    if (!payload.password) delete payload.password;

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate("/admin/clients"), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Client" : "Add Client"}
        subtitle={
          isEdit ? "Update the client's details" : "Their mobile number becomes the portal password"
        }
      >
        <Button variant="outline" onClick={() => navigate("/admin/clients")}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <Card>
          <CardHeader title="Client details" subtitle="Fields marked * are required" />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact person" required>
                <Input name="name" value={form.name} onChange={change} required placeholder="Rajesh Sharma" />
              </Field>

              <Field label="Company">
                <Input
                  name="company"
                  value={form.company}
                  onChange={change}
                  placeholder="Sharma Infrastructure"
                />
              </Field>

              <Field label="Email" required>
                <Input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={change}
                  required
                  placeholder="rajesh@company.com"
                />
              </Field>

              <Field label="Mobile number" required hint="This becomes the portal password">
                <Input
                  name="phone"
                  value={form.phone}
                  onChange={change}
                  required
                  placeholder="98765 43210"
                />
              </Field>

              <Field label="GST number">
                <Input
                  name="gstNumber"
                  value={form.gstNumber}
                  onChange={change}
                  placeholder="08AABCU1234M1Z5"
                />
              </Field>

              <Field label="Status">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={["active", "inactive", "lead"]}
                />
              </Field>

              <Field label="Address" className="sm:col-span-2">
                <Input
                  name="address"
                  value={form.address}
                  onChange={change}
                  placeholder="Jaipur, Rajasthan"
                />
              </Field>

              <Field label="Notes" className="sm:col-span-2" hint="Internal notes, not shared with the client">
                <Textarea name="notes" value={form.notes} onChange={change} />
              </Field>
            </div>

            <LoginCredentials
              email={form.email}
              phone={form.phone}
              password={form.password}
              onPasswordChange={change}
              isEdit={isEdit}
              roleLabel="client"
            >
              <Field label="Portal access">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    name="portalAccess"
                    checked={Boolean(form.portalAccess)}
                    onChange={change}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="text-sm text-slate-700">Portal sign-in enabled</span>
                </label>
              </Field>
            </LoginCredentials>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => navigate("/admin/clients")}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save size={15} />
              {isEdit ? "Save changes" : "Create client"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
