import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Smartphone, TriangleAlert } from "lucide-react";

import { Alert, Badge, Card, CardHeader, EmptyState, Loader, PageHeader } from "../components/ui";

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

/**
 * The Play work one staff member has been put on.
 *
 * One component for both panels because the two views are the same question
 * asked by two roles — and the server already answers it differently for each,
 * from the id arrays. Duplicating the screen would only mean fixing every
 * layout bug twice.
 */
export default function MyPlayWork({ api, base, appPath, title = "Play Store" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/play/my-work`)
      .then(({ data: payload }) => active && setData(payload))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your apps"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base]);

  if (loading) return <Loader label="Loading your apps…" />;

  const consoles = data?.consoles || [];
  const apps = data?.apps || [];
  const alerts = data?.alerts || [];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`${apps.length} app${apps.length === 1 ? "" : "s"} you are assigned to`}
      />

      <Alert>{error}</Alert>

      {alerts.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <div className="px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <TriangleAlert size={15} />
              {alerts.length} policy notice{alerts.length === 1 ? "" : "s"} that touch your work
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800">
              {alerts.map((alert) => (
                <li key={alert._id}>
                  <span className="font-medium">{alert.title}</span>
                  {alert.app?.name && <span> — {alert.app.name}</span>}
                  {alert.deadline && <span> · due {day(alert.deadline)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {consoles.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Consoles you can see" />
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {consoles.map((row) => (
              <div key={row._id} className="bg-white px-4 py-3">
                <p className="font-medium text-slate-900">{row.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {row.client?.name || "Ours"} · <Badge value={row.status} />
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Your apps" subtitle="Open one to see its releases and add a new one" />

        {apps.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="No apps assigned to you yet"
            message="When an admin puts you on an app it appears here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {apps.map((app) => (
              <Link
                key={app._id}
                to={`${appPath}/${app._id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900">{app.name}</p>
                  <p className="font-mono text-xs text-slate-400">{app.packageName}</p>
                </div>

                <span className="text-xs text-slate-500">{app.console?.name}</span>
                <Badge value={app.status} />

                <div className="ml-auto text-right">
                  <p className="text-sm text-slate-700">{app.liveVersionName || "—"}</p>
                  <p className="text-xs text-slate-400">{day(app.lastReleaseAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
