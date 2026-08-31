import { useCallback, useEffect, useState } from "react";
import { Crown, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";

import adminApi from "../adminApi";
import { forgetPermissions } from "../hooks/usePermissions";
import { Alert, Badge, Card, CardHeader, Loader, Select } from "../../shared/components/ui";

/**
 * The admin accounts themselves: who is a super admin, and which permission
 * role each plain admin holds.
 *
 * Only a super admin sees this, and only a super admin can change it — this is
 * the screen that decides what everybody else can reach.
 */
export default function Administrators({ roles = [] }) {
  const [state, setState] = useState({ loading: true, list: [], error: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const { data } = await adminApi.get("/admin/administrators");
      setState({ loading: false, list: data.administrators || [], error: "" });
    } catch (err) {
      // A plain admin simply does not get this section
      const denied = err.response?.status === 403;
      setState({
        loading: false,
        list: [],
        error: denied ? "" : err.response?.data?.message || "Could not load administrators",
        hidden: denied,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (admin, patch) => {
    setBusy(admin._id);
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const { data } = await adminApi.put(`/admin/administrators/${admin._id}`, patch);
      setNotice(data.message || "Updated");
      // This admin's own sidebar may have just changed shape
      forgetPermissions();
      await load();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err.response?.data?.message || "Could not update that account",
      }));
    } finally {
      setBusy("");
    }
  };

  if (state.hidden) return null;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Administrators"
        subtitle="Who holds full access, and which role limits each of the others"
      />

      <div className="px-5 pt-4">
        <Alert>{state.error}</Alert>
        <Alert tone="success">{notice}</Alert>
      </div>

      {state.loading ? (
        <Loader label="Loading administrators…" />
      ) : (
        <div className="divide-y divide-slate-100">
          {state.list.map((admin) => (
            <div key={admin._id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  admin.isSuperAdmin ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
                }`}
              >
                {admin.isSuperAdmin ? <Crown size={16} /> : <ShieldCheck size={16} />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-900">{admin.name}</p>
                  {admin.isSuperAdmin && <Badge tone="blue">Super Admin</Badge>}
                  {admin.status !== "active" && <Badge tone="slate">{admin.status}</Badge>}
                </div>
                <p className="truncate text-xs text-slate-400">{admin.email}</p>
              </div>

              {/* what limits them */}
              <div className="w-48 shrink-0">
                {admin.isSuperAdmin ? (
                  <p className="text-xs text-slate-400">Not limited by any role</p>
                ) : (
                  <Select
                    value={admin.permissionRole?._id || ""}
                    onChange={(e) => update(admin, { permissionRole: e.target.value })}
                    disabled={busy === admin._id}
                    options={roles.map((role) => ({ value: role._id, label: role.name }))}
                    placeholder="No role — full access"
                    className="w-full"
                  />
                )}
              </div>

              <button
                onClick={() => update(admin, { isSuperAdmin: !admin.isSuperAdmin })}
                disabled={busy === admin._id}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  admin.isSuperAdmin
                    ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    : "border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                {busy === admin._id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : admin.isSuperAdmin ? (
                  "Make plain admin"
                ) : (
                  "Make super admin"
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
        An admin with no role assigned has full access — that is how every admin behaved before
        roles were enforced. Give one a role to narrow it. The last super admin cannot be demoted.
      </p>
    </Card>
  );
}
