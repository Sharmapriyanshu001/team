import { useEffect, useState } from "react";
import { Save, KeyRound, LogOut } from "lucide-react";

import hrApi from "../hrApi";
import { saveToken } from "../../shared/createApi";
import useSignOut from "../../shared/useSignOut";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  PageHeader,
} from "../../shared/components/ui";

/**
 * This account's own details, laid out exactly as the admin panel lays out its
 * own — identity on the left, the two forms that change something on the
 * right.
 *
 * One shape for one kind of screen: somebody who has used the admin profile
 * should not have to relearn this one, and a panel where every profile page
 * invents its own arrangement is a panel nobody builds a habit in.
 *
 * The details come from /hr/me rather than from the copy in localStorage. That
 * copy is written at sign-in and again on every save, so it is usually right —
 * but "usually" is how a screen ends up showing a designation somebody changed
 * on another device three weeks ago.
 */
export default function Profile() {
  const [me, setMe] = useState(null);
  const [access, setAccess] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", designation: "", department: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  useEffect(() => {
    hrApi
      .get("/hr/me")
      .then(({ data }) => {
        setMe(data.hr);
        setAccess(data.access);
        setForm({
          name: data.hr.name || "",
          phone: data.hr.phone || "",
          designation: data.hr.designation || "",
          department: data.hr.department || "",
        });
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load your profile"))
      .finally(() => setLoading(false));
  }, []);

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data } = await hrApi.put("/hr/profile", form);
      setMe(data.hr);
      // Keep the header and sidebar in sync with the new name
      localStorage.setItem("hr", JSON.stringify(data.hr));
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
      const { data } = await hrApi.put("/hr/profile/password", {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      // The change signed every other device out. This one stays signed in
      // only because the server hands back a token minted after the bump.
      saveToken("hrToken", data?.token);
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      setPwSuccess("Password changed. Any other device is now signed out.");
    } catch (err) {
      setPwError(err.response?.data?.message || "Could not change the password");
    } finally {
      setChanging(false);
    }
  };

  const { askSignOut, signOutDialog } = useSignOut({
    tokenKey: "hrToken",
    userKey: "hr",
    loginPath: "/",
    panel: "the HR panel",
  });

  if (loading) return <Loader />;

  const initials = (me?.name || "H")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
        {/* -------------------------------------------------- identity card */}
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white">
              {initials}
            </span>
            <p className="mt-4 text-lg font-semibold text-slate-900">{me?.name}</p>
            <p className="text-sm text-slate-500">{me?.email}</p>
            <div className="mt-3">
              {/* What this account actually is, which is not always what the
                  role string says — an HR head and an HR manager reach
                  different screens */}
              <Badge tone={access?.isHrAdmin ? "black" : "blue"}>
                {me?.roleLabel || (access?.isHrAdmin ? "HR Head" : "HR Manager")}
              </Badge>
            </div>

            <dl className="mt-6 w-full space-y-2 border-t border-slate-100 pt-4 text-left text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">Designation</dt>
                <dd className="font-medium text-slate-800">{me?.designation || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Department</dt>
                <dd className="font-medium text-slate-800">{me?.department || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Phone</dt>
                <dd className="font-medium text-slate-800">{me?.phone || "—"}</dd>
              </div>
            </dl>
          </div>
        </Card>

        {/* ------------------------------------------------------- forms */}
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
                    <Input value={me?.email || ""} disabled />
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
                    <Input
                      name="designation"
                      value={form.designation}
                      onChange={change}
                      placeholder="HR Head"
                    />
                  </Field>

                  <Field label="Department" className="sm:col-span-2">
                    <Input
                      name="department"
                      value={form.department}
                      onChange={change}
                      placeholder="Human Resources"
                    />
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
                      onChange={(e) =>
                        setPasswords((prev) => ({ ...prev, confirm: e.target.value }))
                      }
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
