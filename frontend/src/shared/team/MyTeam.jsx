import { useEffect, useState } from "react";
import { Crown, Users } from "lucide-react";

import { Alert, Badge, Card, CardHeader, EmptyState, Loader, PageHeader } from "../components/ui";
import Progress from "../../admin/pages/teams/Progress";

/**
 * My team, and the numbers I am carrying this month.
 *
 * The same Progress bar the admin sees, deliberately — a target that looks one
 * way to the person who set it and another to the person carrying it is a
 * target two people will disagree about at the end of the month.
 */
export default function MyTeam({ api, base }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/team/mine`)
      .then(({ data: payload }) => active && setData(payload))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your team"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base]);

  if (loading) return <Loader label="Loading your team…" />;

  const teams = data?.teams || [];
  const mine = data?.mine || [];
  const teamTargets = data?.teamTargets || [];

  return (
    <div>
      <PageHeader
        title="My Team"
        subtitle={
          mine.length
            ? `${mine.length} target${mine.length === 1 ? "" : "s"} on you this month`
            : "Where you sit, and what the team is aiming at"
        }
      />

      <Alert>{error}</Alert>

      {teams.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="You are not on a team yet"
            message="Once an admin puts you on one, your targets and the team's show up here."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="On you"
                subtitle={mine.length ? "Your own numbers this month" : ""}
              />
              <div className="px-4 py-4">
                {mine.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">
                    Nothing set on you personally this month.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {mine.map((target) => (
                      <Progress key={target._id} target={target} />
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {teamTargets.length > 0 && (
              <Card>
                <CardHeader title="What the team is aiming at" />
                <div className="space-y-4 px-4 py-4">
                  {teamTargets.map((target) => (
                    <Progress key={target._id} target={target} />
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            {teams.map((team) => (
              <Card key={team._id}>
                <CardHeader
                  title={team.name}
                  subtitle={team.description || undefined}
                  action={<Badge value={team.kind} />}
                />

                <div className="divide-y divide-slate-100">
                  {team.manager && (
                    <div className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <Crown size={14} className="shrink-0 text-amber-500" />
                      <span className="font-medium text-slate-900">{team.manager.name}</span>
                      <span className="text-xs text-slate-400">manager</span>
                    </div>
                  )}

                  {(team.operationsManagers || []).map((person) => (
                    <div key={person._id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="text-slate-900">{person.name}</span>
                      <span className="text-xs text-slate-400">
                        operations manager{person.designation && ` · ${person.designation}`}
                      </span>
                    </div>
                  ))}

                  {(team.members || []).map((person) => (
                    <div key={person._id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="text-slate-700">{person.name}</span>
                      {person.designation && (
                        <span className="text-xs text-slate-400">{person.designation}</span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
