import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Save, KeyRound, LogOut, MessageSquare } from "lucide-react";

import employeeApi from "../employeeApi";
import { saveToken } from "../../shared/createApi";
import { useEmployee } from "../employeeContext";
import { initialsOf } from "../../shared/format";
import useSignOut from "../../shared/useSignOut";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
} from "../../shared/components/ui";

export default function Profile() {
  const navigate = useNavigate();
  const { employee, setEmployee } = useEmployee();

  const [form, setForm] = useState({
    name: employee?.name || "",
    phone: employee?.phone || "",
  });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data } = await employeeApi.put("/employee/profile", form);
      setEmployee(data.employee);
      localStorage.setItem("employee", JSON.stringify(data.employee));
      setSuccess("Profile updated successfully");
    } catch (err) {
      setError(err.response?.data?.message || "Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");

    if (passwords.newPassword !== passwords.confirm) {
      setPwError("New password and confirmation do not match");
      return;
    }

    setChanging(true);
    try {
      const { data } = await employeeApi.put("/employee/profile/password", {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      // The change signed every other device out. This one stays signed in
      // only because the server hands back a token minted after the bump.
      saveToken("employeeToken", data?.token);
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      setPwSuccess("Password changed. Any other device is now signed out.");
    } catch (err) {
      setPwError(err.response?.data?.message || "Could not change the password");
    } finally {
      setChanging(false);
    }
  };

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "employeeToken",
    userKey: "employee",
    loginPath: "/employee/login",
    panel: "your workspace",
  });

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account details and password">
        <Button variant="outline" onClick={askSignOut}>
          <LogOut size={15} />
          Logout
        </Button>
      </PageHeader>

      {signOutDialog}

      <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white">
              {initialsOf(employee?.name)}
            </span>
            <p className="mt-4 text-lg font-semibold text-slate-900">{employee?.name}</p>
            <p className="text-sm text-slate-500">{employee?.email}</p>
            <div className="mt-3">
              <Badge tone="blue">Employee</Badge>
            </div>

            <dl className="mt-6 w-full space-y-2 border-t border-slate-100 pt-4 text-left text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Designation</dt>
                <dd className="truncate font-medium text-slate-800">
                  {employee?.designation || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Department</dt>
                <dd className="truncate font-medium text-slate-800">
                  {employee?.department || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Team leader</dt>
                <dd className="truncate font-medium text-slate-800">
                  {employee?.teamLeader?.name || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Joined</dt>
                <dd className="font-medium text-slate-800">
                  {employee?.joiningDate
                    ? new Date(employee.joiningDate).toLocaleDateString("en-IN")
                    : "—"}
                </dd>
              </div>
            </dl>

            {employee?.teamLeader && (
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => navigate("/employee/chat/team-leader")}
              >
                <MessageSquare size={15} />
                Message your leader
              </Button>
            )}

            <p className="mt-4 text-[11px] text-slate-400">
              Your designation, department and team leader are managed by the admin.
            </p>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Account details" subtitle="Your email cannot be changed here" />
            <form onSubmit={handleSave}>
              <div className="p-5">
                <Alert>{error}</Alert>
                <Alert tone="success">{success}</Alert>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Full name" required>
                    <Input name="name" value={form.name} onChange={change} required />
                  </Field>

                  <Field label="Email">
                    <Input value={employee?.email || ""} disabled />
                  </Field>

                  <Field label="Phone">
                    <Input
                      name="phone"
                      value={form.phone}
                      onChange={change}
                      placeholder="98765 43210"
                    />
                  </Field>

                  <Field label="Designation">
                    <Input value={employee?.designation || ""} disabled />
                  </Field>
                </div>
              </div>

              <div className="flex justify-end border-t border-slate-100 px-5 py-4">
                <Button type="submit" loading={saving}>
                  <Save size={15} />
                  Save changes
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader title="Change password" subtitle="Use at least 6 characters" />
            <form onSubmit={handlePassword}>
              <div className="p-5">
                <Alert>{pwError}</Alert>
                <Alert tone="success">{pwSuccess}</Alert>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Current password" required>
                    <Input
                      type="password"
                      value={passwords.currentPassword}
                      onChange={(e) =>
                        setPasswords((prev) => ({ ...prev, currentPassword: e.target.value }))
                      }
                      required
                      autoComplete="current-password"
                    />
                  </Field>

                  <Field label="New password" required>
                    <Input
                      type="password"
                      value={passwords.newPassword}
                      onChange={(e) =>
                        setPasswords((prev) => ({ ...prev, newPassword: e.target.value }))
                      }
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </Field>

                  <Field label="Confirm new password" required>
                    <Input
                      type="password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords((prev) => ({ ...prev, confirm: e.target.value }))}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
              </div>

              <div className="flex justify-end border-t border-slate-100 px-5 py-4">
                <Button type="submit" variant="dark" loading={changing}>
                  <KeyRound size={15} />
                  Change password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
