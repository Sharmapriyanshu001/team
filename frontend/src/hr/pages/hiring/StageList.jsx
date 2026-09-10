import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, RotateCcw, Undo2, UserX } from "lucide-react";

import hrApi from "../../hrApi";
import useHrAccess from "../../hooks/useHrAccess";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import {
  CANDIDATE_SOURCES,
  NEXT_STAGE,
  shortDate,
  sourceLabel,
  stageLabel,
} from "../../../shared/hr/constants";

/**
 * One stage of the pipeline, as a list.
 *
 * Shortlisted, Selected and Rejected are the same screen pointed at different
 * stages — they ask the same question of the same records, and three copies of
 * it would be three places to fix the next thing that is wrong with it.
 *
 * `stages` is a list rather than a value because "selected" has a legacy
 * spelling: rows written before Hiring existed carry "offer", and a Selected
 * screen that quietly omitted them would be worse than useless.
 */
export default function StageList({
  stages,
  title,
  subtitle,
  advanceTo,
  advanceLabel,
  emptyTitle,
  emptyMessage,
  showRejection = false,
}) {
  const { can } = useHrAccess();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");

  const [moving, setMoving] = useState(null);
  const [move, setMove] = useState({ stage: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    /**
     * One request per stage in the set. The server filters by a single stage,
     * and the alternative — teaching it a list — would be a wider query
     * interface for the sake of the one screen that has two.
     */
    Promise.all(
      stages.map((stage) =>
        hrApi
          .get("/hr/candidates", {
            params: { stage, limit: 200, search: search || undefined, source: source || undefined },
          })
          .then(({ data }) => data.items || [])
      )
    )
      .then((sets) => {
        if (!active) return;
        const merged = sets.flat();
        // Newest decision first, whichever decision this screen is about
        merged.sort(
          (a, b) =>
            new Date(b.selectedAt || b.shortlistedAt || b.rejectedAt || b.createdAt) -
            new Date(a.selectedAt || a.shortlistedAt || a.rejectedAt || a.createdAt)
        );
        setRows(merged);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load candidates"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages.join(","), search, source, reloadKey]);

  const openMove = (row, stage) => {
    setMoving(row);
    setMove({ stage, reason: "" });
    setFormError("");
  };

  const submitMove = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await hrApi.put(`/hr/hiring/candidates/${moving._id}/stage`, move);
      setMoving(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not move this candidate");
    } finally {
      setSaving(false);
    }
  };

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
    {
      key: "position",
      header: "For",
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.position || "—"}</p>
          <p className="text-xs text-slate-400">{row.department || "—"}</p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (row) => <span className="text-slate-600">{sourceLabel(row.source)}</span>,
    },
    {
      key: "interviews",
      header: "Rounds",
      render: (row) =>
        row.interviews?.length ? (
          <span className="text-slate-700">{row.interviews.length}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "when",
      header: "Decided",
      render: (row) => (
        <span className="text-slate-600">
          {shortDate(row.selectedAt || row.shortlistedAt || row.rejectedAt || row.createdAt)}
        </span>
      ),
    },
    ...(showRejection
      ? [
          {
            key: "rejectionReason",
            header: "Reason",
            render: (row) => (
              <span className="line-clamp-2 max-w-[220px] text-slate-600">
                {row.rejectionReason || "—"}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "stage",
      header: "Stage",
      render: (row) => <Badge value={row.stage}>{stageLabel(row.stage)}</Badge>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        if (!can("hiring", "edit") || row.hiredUser) return null;

        return (
          <div className="flex justify-end gap-1.5">
            {advanceTo && (
              <Button
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  openMove(row, advanceTo);
                }}
              >
                {advanceLabel}
                <ArrowRight size={13} />
              </Button>
            )}
            {showRejection ? (
              // Putting somebody back in play — the whole point of keeping
              // rejected candidates rather than deleting them
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openMove(row, "screening");
                }}
                title="Put back in the pipeline"
                className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
              >
                <RotateCcw size={15} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openMove(row, "rejected");
                }}
                title="Not taking forward"
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <UserX size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const movingBack = move.stage === "screening" && showRejection;

  return (
    <div>
      <PageHeader title={title} subtitle={`${rows.length} ${subtitle}`} />

      <Alert>{error}</Alert>

      <Card>
        <Toolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by name, email, position or skill"
          onFilter={(key, value) => key === "source" && setSource(value)}
          filters={[
            { key: "source", value: source, placeholder: "Any source", options: CANDIDATE_SOURCES },
          ]}
        />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
        />
      </Card>

      <p className="mt-3 text-xs text-slate-500">
        Every candidate here is the same record shown on{" "}
        <Link to="/hr/hiring/candidates" className="font-medium text-blue-600 hover:text-blue-700">
          Candidates
        </Link>
        {advanceTo === "selected" && (
          <>
            {" "}
            — moving one to Selected opens their{" "}
            <Link
              to="/hr/hiring/onboarding"
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              onboarding
            </Link>
          </>
        )}
        .
      </p>

      {/* --------------------------------------------------------- the move */}
      <Modal
        open={Boolean(moving)}
        onClose={() => setMoving(null)}
        title={
          movingBack
            ? "Put back in the pipeline"
            : move.stage === "rejected"
              ? "Not taking forward"
              : `Move to ${stageLabel(move.stage)}`
        }
        subtitle={moving ? `${moving.name}${moving.position ? ` · ${moving.position}` : ""}` : ""}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setMoving(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitMove}
              loading={saving}
              variant={move.stage === "rejected" ? "danger" : "primary"}
            >
              {movingBack ? "Reopen" : move.stage === "rejected" ? "Reject" : "Move"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitMove} className="space-y-3">
          <Alert>{formError}</Alert>

          {move.stage === "rejected" && (
            <Field label="Reason" hint="Kept on the record — it is how a source is judged later">
              <Textarea
                rows={3}
                value={move.reason}
                onChange={(e) => setMove({ ...move, reason: e.target.value })}
                placeholder="Asked above the band"
              />
            </Field>
          )}

          {movingBack && (
            <Field label="Back to" hint="Where they rejoin the pipeline">
              <Select
                value={move.stage}
                onChange={(e) => setMove({ ...move, stage: e.target.value })}
                options={Object.keys(NEXT_STAGE).map((stage) => ({
                  value: stage,
                  label: stageLabel(stage),
                }))}
              />
            </Field>
          )}

          {move.stage === "selected" && (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              <Undo2 size={13} className="mt-0.5 shrink-0" />
              This opens their onboarding checklist. They become an employee when onboarding is
              completed, which is what creates their login.
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
