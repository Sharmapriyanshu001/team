import { useState } from "react";
import { KeyRound, User } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import { readStoredUser, saveToken } from "../../shared/createApi";
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

/**
 * This account's own details.
 *
 * Changing the password signs every other device out — that is the point of
 * changing one you think somebody else knows — and the server hands back a
 * fresh token so the device doing the changing stays signed in.
 */
export default function Profile() {
  const stored = readStoredUser("hr");
  const { isHrAdmin } = useHrAccess();

  const [form, setForm] = useState({
    name: stored?.name || "",
    phone: stored?.phone || "",
    designation: stored?.designation || "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileDone, setProfileDone] = useState("");

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordDone, setPasswordDone] = useState("");

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    setProfileDone("");

    try {
      const { data } = await hrApi.put("/hr/profile", form);
      // Keep the stored copy in step so the topbar and sidebar update
      localStorage.setItem("hr", JSON.stringify({ ...stored, ...data.hr }));
      setProfileDone(data.message);
    } catch (err) {
      setProfileError(err.response?.data?.message || "Could not save your profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordError("");
    setPasswordDone("");

    try {
      const { data } = await hrApi.put("/hr/profile/password", passwords);
      // The old token stopped working the moment the version bumped
      saveToken("hrToken", data.token);
      setPasswords({ currentPassword: "", newPassword: "" });
      setPasswordDone(data.message);
    } catch (err) {
      setPasswordError(err.response?.data?.message || "Could not change your password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your own details and password">
        <Badge tone={isHrAdmin ? "black" : "blue"}>{isHrAdmin ? "HR Head" : "HR Manager"}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your details"
            subtitle="Your email is your login and is changed by whoever set the account up"
            action={<User size={15} className="text-slate-400" />}
          />
          <form onSubmit={saveProfile} className="space-y-3 p-4">
            <Alert>{profileError}</Alert>
            <Alert tone="success">{profileDone}</Alert>

            <Field label="Email">
              <Input value={stored?.email || ""} disabled />
            </Field>

            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Designation">
                <Input
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                />
              </Field>
            </div>

            <Button type="submit" loading={savingProfile}>
              Save
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Password"
            subtitle="Changing it signs you out everywhere else, which is the point"
            action={<KeyRound size={15} className="text-slate-400" />}
          />
          <form onSubmit={savePassword} className="space-y-3 p-4">
            <Alert>{passwordError}</Alert>
            <Alert tone="success">{passwordDone}</Alert>

            <Field label="Current password" required>
              <Input
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(e) =>
                  setPasswords({ ...passwords, currentPassword: e.target.value })
                }
                required
              />
            </Field>

            <Field label="New password" hint="At least 6 characters" required>
              <Input
                type="password"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                required
              />
            </Field>

            <Button type="submit" loading={savingPassword}>
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
