import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, Users } from "lucide-react";

import hrApi from "../../hrApi";
import DataTable from "../../../shared/components/DataTable";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  ProgressBar,
} from "../../../shared/components/ui";
import {
  CANDIDATE_STAGES,
  daysSince,
  employmentTypeLabel,
  openingStatusLabel,
  salaryBand,
  shortDate,
  sourceLabel,
  stageLabel,
} from "../../../shared/hr/constants";

/**
 * One vacancy with its pipeline hanging off it.
 *
 * This is the view that makes an opening worth recording at all: three
 * candidates is good news for one seat and bad news for five, and neither the
 * candidate list nor the openings table can say which of those you are looking
 * at on its own.
 */
export default function OpeningDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get(`/hr/hiring/openings/${id}/detail`)
      .then(({ data: body }) => active && setData(body))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load this opening"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [id]);

  if (loading && !data) return <Loader label="Loading opening…" />;
  if (error && !data) {
    return (
      <div>
        <Alert>{error}</Alert>
        <Button variant="outline" onClick={() => navigate("/hr/hiring/openings")}>
          <ArrowLeft size={15} />
          Back to openings
        </Button>
      </div>
    );
  }

  const { item, candidates, pipeline, stats } = data;

  const columns = [
    {
      key: "name",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.email || row.phone || "—"}</p>
        </div>
      ),
    },
    { key: "source", header: "Source", render: (row) => sourceLabel(row.source) },
    {
      key: "interviews",
      header: "Rounds",
      render: (row) => row.interviews?.length || <span className="text-slate-400">—</span>,
    },
    { key: "createdAt", header: "Applied", render: (row) => shortDate(row.createdAt) },
    {
      key: "stage",
      header: "Stage",
      render: (row) => (
        <div>
          <Badge value={row.stage}>{stageLabel(row.stage)}</Badge>
          {row.hiredUser && (
            <p className="mt-1 text-[11px] text-slate-400">{row.hiredUser.email}</p>
          )}
        </div>
      ),
    },
  ];

  const filled = Math.round((stats.hired / (item.positions || 1)) * 100);

  return (
    <div>
      <PageHeader
        title={item.title}
        subtitle={[item.code, item.department, item.location].filter(Boolean).join(" · ")}
      >
        <Button variant="outline" onClick={() => navigate("/hr/hiring/openings")}>
          <ArrowLeft size={15} />
          All Openings
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Applicants", stats.applicants, `${stats.inPlay} still in play`],
          ["Seats", item.positions ?? 1, `${stats.remaining} still to fill`],
          ["Hired", stats.hired, `${filled}% filled`],
          ["Interviews", stats.interviews, `${stats.rejected} not taken forward`],
        ].map(([label, value, hint]) => (
          <Card key={label}>
            <div className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="text-xl font-bold text-slate-900">{value}</p>
              <p className="text-[11px] text-slate-400">{hint}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="The role" subtitle={openingStatusLabel(item.status)} />
          <dl className="divide-y divide-slate-100">
            {[
              ["Status", openingStatusLabel(item.status)],
              ["Type", employmentTypeLabel(item.employmentType)],
              ["Experience", item.experience],
              ["Band", salaryBand(item.salaryMin, item.salaryMax)],
              ["Owner", item.owner?.name],
              ["Reports to", item.reportsTo?.name],
              ["Opened", `${shortDate(item.openedOn)} · ${daysSince(item.openedOn)} days ago`],
              ["Fill by", item.targetDate ? shortDate(item.targetDate) : "Not set"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <dt className="text-slate-500">{label}</dt>
                <dd className="max-w-[60%] text-right text-slate-900">{value || "—"}</dd>
              </div>
            ))}
          </dl>

          {(item.skills?.length > 0 || item.requirements?.length > 0) && (
            <div className="space-y-2 border-t border-slate-100 p-4">
              {item.skills?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.skills.map((skill) => (
                      <Badge key={skill} tone="slate">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {item.requirements?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Requirements
                  </p>
                  <ul className="list-inside list-disc text-xs text-slate-600">
                    {item.requirements.map((req) => (
                      <li key={req}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {item.description && (
            <p className="border-t border-slate-100 p-4 text-xs text-slate-600">
              {item.description}
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="The pipeline for this role"
            subtitle={`${stats.hired} of ${item.positions ?? 1} seats filled`}
            action={
              <div className="w-32">
                <ProgressBar value={filled} />
              </div>
            }
          />

          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
            {CANDIDATE_STAGES.map((stage) => (
              <span
                key={stage.value}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs"
              >
                <span className="text-slate-500">{stage.label}</span>{" "}
                <span className="font-semibold text-slate-900">{pipeline[stage.value] || 0}</span>
              </span>
            ))}
          </div>

          {candidates.length ? (
            <DataTable
              columns={columns}
              rows={candidates}
              emptyTitle="Nobody yet"
              emptyMessage="Attach a candidate to this opening from the Candidates list."
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No candidates on this opening"
              message="Attach one from the Candidates list and the pipeline builds here."
            />
          )}
        </Card>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <Briefcase size={13} className="mt-0.5 shrink-0" />
        This opening closes itself once {item.positions ?? 1}{" "}
        {(item.positions ?? 1) === 1 ? "person has" : "people have"} joined —{" "}
        <Link to="/hr/hiring/onboarding" className="font-medium text-blue-600 hover:text-blue-700">
          onboarding
        </Link>{" "}
        is what counts a hire.
      </p>
    </div>
  );
}
