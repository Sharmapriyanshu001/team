import { useEffect, useState } from "react";
import { Briefcase, KeyRound, UserRound } from "lucide-react";

import salesApi from "../salesApi";
import { forgetSalesAccess } from "../hooks/useSalesAccess";
import { saveToken } from "../../shared/createApi";
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
  TagField,
  Textarea,
} from "../../shared/components/ui";

/**
 * The account looking at it.
 *
 * Deliberately narrow: name, phone, designation and the password. Role and
 * status are absent because an executive promoting themselves is exactly what
 * the panel's one privileged screen exists to prevent — and the server refuses
 * them here regardless of what this form sends.
 */
/** The stored values are snake_case; these are what a person reads. */
const WORK_LOCATION_LABELS = {
  office: "Office",
  field: "Field",
  hybrid: "Hybrid",
  remote: "Remote",
};

const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
};

/** One recorded fact, printed only when there is one. */
function Fact({ label, value }) {
  if (!value && value !== 0) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  );
}

export default function Profile() {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    designation: "",
    address: "",
    skills: [],
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwNotice, setPwNotice] = useState("");

  useEffect(() => {
    let active = true;
    salesApi
      .get("/sales/me")
      .then(({ data }) => {
        if (!active) return;
        setMe(data.sales);
        setForm({
          name: data.sales.name || "",
          phone: data.sales.phone || "",
          designation: data.sales.designation || "",
          address: data.sales.address || "",
          skills: data.sales.skills || [],
        });
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your profile"));
    return () => {
      active = false;
    };
  }, []);

  const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await salesApi.put("/sales/me", form);
      setMe(data.sales);
      localStorage.setItem("sales", JSON.stringify(data.sales));
      setNotice("Profile updated");
    } catch (err) {
      setError(err.response?.data?.message || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e?.preventDefault();
    setPwError("");
    setPwNotice("");

    if (pw.newPassword !== pw.confirm) {
      setPwError("The two new passwords do not match");
      return;
    }

    setPwBusy(true);
    try {
      const { data } = await salesApi.put("/sales/me/password", {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      /**
       * Changing a password signs every other device out. The server hands
       * back a fresh token so this one stays in, which is what somebody
       * expects when they change a password because they think it is known.
       */
      saveToken("salesToken", data.token);
      forgetSalesAccess();
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setPwNotice(data.message || "Password changed");
    } catch (err) {
      setPwError(err.response?.data?.message || "Could not change your password");
    } finally {
      setPwBusy(false);
    }
  };

  if (!me && !error) return <Loader label="Loading your profile…" />;

  return (
    <div className="space-y-4">
      <PageHeader title="My profile" subtitle="Your details and your password" />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {me && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Details" />
            <form className="space-y-4 p-4 pt-0" onSubmit={save}>
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                  <UserRound size={18} />
                </span>
                <div>
                  <p className="font-medium text-slate-900">{me.email}</p>
                  <Badge value={me.isSalesHead ? "Sales head" : "Sales executive"} />
                </div>
              </div>

              <Field label="Name" required>
                <Input name="name" value={form.name} onChange={change} required />
              </Field>
              <Field label="Mobile">
                <Input name="phone" value={form.phone} onChange={change} />
              </Field>
              <Field label="Designation">
                <Input name="designation" value={form.designation} onChange={change} />
              </Field>
              <Field label="Address">
                <Textarea
                  name="address"
                  rows={2}
                  value={form.address}
                  onChange={change}
                  placeholder="House, street, city, state, PIN"
                />
              </Field>
              {/**
                * Skills are editable here and responsibilities are not, which
                * is deliberate: a skill is something you brought and know
                * better than HR does, a responsibility is something you were
                * given. The server refuses the second from this route too.
                */}
              <Field label="Skills" hint="What you brought with you">
                <TagField
                  value={form.skills}
                  onChange={(next) => setForm((p) => ({ ...p, skills: next }))}
                  emptyLabel="No skills recorded yet"
                  placeholder="A skill — type it and press Enter"
                />
              </Field>

              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </Card>

          {/**
            * What HR recorded about the job. Read-only on purpose — every one
            * of these was a decision somebody else made, and a person editing
            * their own team size or reporting line would make the field mean
            * nothing on the day it mattered. It is shown rather than hidden so
            * that a record that has gone stale is visible to the one person
            * certain to notice.
            */}
          {(me.salesRole ||
            me.employeeId ||
            me.workLocation ||
            me.employmentType ||
            me.teamSize > 0 ||
            me.reportsToName ||
            (me.responsibilities || []).length > 0) && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Your role"
                subtitle="Recorded by HR — ask them if any of it is out of date"
              />
              <div className="space-y-4 p-4 pt-0">
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <Fact label="Employee ID" value={me.employeeId} />
                  <Fact label="Sales role" value={me.salesRole} />
                  <Fact label="Work location" value={WORK_LOCATION_LABELS[me.workLocation]} />
                  <Fact label="Employment" value={EMPLOYMENT_TYPE_LABELS[me.employmentType]} />
                  <Fact
                    label="Team size"
                    value={me.teamSize ? `${me.teamSize} people` : ""}
                  />
                  <Fact label="Reports to" value={me.reportsToName} />
                </div>

                {(me.responsibilities || []).length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <Briefcase size={11} /> What you handle
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {me.responsibilities.map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Password"
              subtitle="Changing it signs your other devices out"
            />
            <form className="space-y-4 p-4 pt-0" onSubmit={changePassword}>
              {pwError && <Alert>{pwError}</Alert>}
              {pwNotice && <Alert tone="success">{pwNotice}</Alert>}

              <Field label="Current password" required>
                <Input
                  type="password"
                  value={pw.currentPassword}
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password" hint="At least 6 characters" required>
                <Input
                  type="password"
                  value={pw.newPassword}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                  required
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm it" required>
                <Input
                  type="password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  required
                  autoComplete="new-password"
                />
              </Field>

              <Button type="submit" disabled={pwBusy}>
                <KeyRound size={14} /> {pwBusy ? "Changing…" : "Change password"}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
