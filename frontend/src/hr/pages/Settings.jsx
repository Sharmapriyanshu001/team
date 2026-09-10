import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Lock, ShieldCheck } from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Loader,
  PageHeader,
} from "../../shared/components/ui";
import { readStoredUser } from "../../shared/createApi";

/**
 * What this HR account is, and the company details it works against.
 *
 * The company record is read-only here and says so. It is the administrator's
 * to set — an HR panel that could rewrite the company's GSTIN would be a
 * surprising thing to have built, and the server does not offer the route.
 */

const MODULE_LABELS = {
  dashboard: "Dashboard",
  employees: "Employees",
  hr_managers: "HR Managers",
  attendance: "Attendance",
  leaves: "Leave",
  recruitment: "Recruitment",
  candidates: "Candidates",
  documents: "Documents",
  reports: "Reports",
  settings: "Settings",
};

export default function Settings() {
  const hr = readStoredUser("hr");
  const { access, isHrAdmin, loading: accessLoading } = useHrAccess();

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    hrApi
      .get("/hr/settings")
      .then(({ data }) => active && setSettings(data.settings))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load settings"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  if (loading || accessLoading) return <Loader label="Loading settings…" />;

  const modules = Object.entries(access?.modules || {});

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Your account, and the company details HR works against"
      />

      <Alert>{error}</Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your account"
            subtitle="Change your name, phone or password under Profile"
            action={
              <Link
                to="/hr/profile"
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Profile <ArrowRight size={13} />
              </Link>
            }
          />
          <dl className="divide-y divide-slate-100">
            {[
              ["Name", hr?.name],
              ["Email", hr?.email],
              ["Designation", hr?.designation],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right text-slate-900">{value || "—"}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <dt className="text-slate-500">Role</dt>
              <dd>
                <Badge tone={isHrAdmin ? "black" : "blue"}>
                  {isHrAdmin ? "HR Head" : "HR Manager"}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Company"
            subtitle="Set by the administrator — read-only here"
            action={<Building2 size={15} className="text-slate-400" />}
          />
          <dl className="divide-y divide-slate-100">
            {[
              ["Name", settings?.companyName],
              ["Email", settings?.companyEmail],
              ["Phone", settings?.companyPhone],
              ["Address", settings?.address],
              ["Working hours", settings?.workingHours],
              ["Timezone", settings?.timezone],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <dt className="text-slate-500">{label}</dt>
                <dd className="max-w-[60%] text-right text-slate-900">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="What this account reaches"
            subtitle="The HR panel contains nothing outside HR — there is no route behind it that touches a lead, an invoice, a project or the vault"
            action={<ShieldCheck size={15} className="text-slate-400" />}
          />
          <div className="flex flex-wrap gap-2 p-4">
            {modules.map(([module, actions]) => (
              <span
                key={module}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium text-slate-800">
                  {MODULE_LABELS[module] || module.replace(/_/g, " ")}
                </span>
                <span className="ml-1.5 text-slate-400">{actions.join(" · ")}</span>
              </span>
            ))}
          </div>

          {!isHrAdmin && (
            <p className="flex items-start gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              <Lock size={13} className="mt-0.5 shrink-0" />
              Managing HR logins belongs to the HR head. Ask them, or an administrator, if you need
              a colleague set up.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
