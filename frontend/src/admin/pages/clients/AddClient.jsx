import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";

import { useRecordForm } from "../../hooks/crud";
import LoginCredentials from "../../components/LoginCredentials";
import PreviousProject from "./PreviousProject";
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
  // The earlier job this client is coming back about, if there is one
  previousProject: "",
};

/**
 * Add a client, or edit one when the URL carries "?id=".
 *
 * `listPath` is where Cancel and a finished edit go back to — its own list by
 * default, and the Team & Accounts panel when it is opened from there.
 * `embedded` drops the PageHeader for the same reason the staff form does.
 */
export default function AddClient({ embedded = false, listPath = "/admin/clients" }) {
  const navigate = useNavigate();
  const { form, change, setValue, submit, isEdit, loading, saving, error, success } =
    useRecordForm("clients", EMPTY);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // An empty password means "leave it as it is"
    const payload = { ...form };
    if (!payload.password) delete payload.password;

    /**
     * The record comes back with previousProject populated, so the form may be
     * holding the whole project rather than its id. Sending that back would
     * fail to cast.
     */
    if (payload.previousProject && typeof payload.previousProject === "object") {
      payload.previousProject = payload.previousProject._id;
    }

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate(listPath), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isEdit ? "Edit client" : "Add client"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEdit
                ? "Update the client's details"
                : "Their mobile number becomes the portal password"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(listPath)}>
            <ArrowLeft size={15} />
            Back to list
          </Button>
        </div>
      ) : (
        <PageHeader
          title={isEdit ? "Edit Client" : "Add Client"}
          subtitle={
            isEdit
              ? "Update the client's details"
              : "Their mobile number becomes the portal password"
          }
        >
          <Button variant="outline" onClick={() => navigate(listPath)}>
            <ArrowLeft size={15} />
            Back
          </Button>
        </PageHeader>
      )}

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

            {/* Answered once here; every project created for this client
                afterwards inherits the link — see the projects beforeSave */}
            <PreviousProject
              value={form.previousProject?._id || form.previousProject || ""}
              onChange={(id) => setValue("previousProject", id)}
            />

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
            <Button type="button" variant="outline" onClick={() => navigate(listPath)}>
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
