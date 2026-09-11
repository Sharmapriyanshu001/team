import { useEffect, useState } from "react";
import { Check, Eye, Play, RotateCcw } from "lucide-react";

import adminApi from "../adminApi";
import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
} from "../../shared/components/ui";

const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];

const STATUS_LABELS = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const TILE_TONES = {
  slate: "bg-slate-50 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  red: "bg-red-50 text-red-700 ring-red-100",
};

function Tile({ label, value, hint, tone = "slate" }) {
  return (
    <div className={`rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${TILE_TONES[tone]}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
      {hint && <p className="text-[10px] opacity-60">{hint}</p>}
    </div>
  );
}

/** One labelled fact in the drawer. */
function Row({ label, value, className = "" }) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 break-words text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

/**
 * One issue, read-only.
 *
 * The description is the half of an issue that matters and the table has never
 * had room for it — until this, reading it meant opening the edit form, which
 * turns looking something up into an accidental write.
 */
function IssueDetail({ open, onClose, row, onResolve, busy }) {
  if (!row) return null;

  const done = ["resolved", "closed"].includes(row.status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row.title}
      subtitle={row.project?.name || "No project"}
      size="lg"
      footer={
        done ? (
          <Button variant="outline" onClick={() => onResolve(row, "open")} loading={busy}>
            <RotateCcw size={15} />
            Reopen
          </Button>
        ) : (
          <Button onClick={() => onResolve(row, "resolved")} loading={busy}>
            <Check size={15} />
            Mark resolved
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={row.severity} />
          <Badge value={row.status}>{STATUS_LABELS[row.status] || row.status}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
          <Row label="Raised by" value={row.raisedBy?.name} />
          <Row label="Owner" value={row.assignedTo?.name || "Unassigned"} />
          <Row label="Reported" value={fmtDate(row.createdAt)} />
          <Row label="Resolved" value={row.resolvedAt ? fmtDate(row.resolvedAt) : "Not yet"} />
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-slate-900">Description</p>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {row.description || "Nothing was written down beyond the title."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default function Issues() {
  const crud = useCrud("issues");
  const lookups = useLookups();


  /** Whose issue is open for reading. Looking is not editing. */
  const [viewing, setViewing] = useState(null);
  /** Which row's status button is mid-flight, so only that one spins. */
  const [moving, setMoving] = useState("");
  const [summary, setSummary] = useState(null);

  /**
   * The counts above the table, across every issue rather than the page on
   * screen. Re-read whenever the list is, so resolving something moves the
   * tiles at the same moment it moves the row.
   */
  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/issues/summary")
      .then(({ data }) => active && setSummary(data))
      .catch(() => active && setSummary(null));

    return () => {
      active = false;
    };
  }, [crud.rows]);

  /**
   * Moving an issue along without opening the form.
   *
   * Resolving is the thing this page is for, and making somebody open a modal,
   * find a dropdown and press Save to do it is why issues sit at "in progress"
   * long after the work stopped. The server owns resolvedAt — see
   * models/Issue.js — so this sends the status and nothing else.
   */
  const setStatus = async (row, status) => {
    setMoving(row._id);
    try {
      await crud.update(row._id, { status });
      setViewing((open) => (open?._id === row._id ? { ...open, status } : open));
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not update that issue");
    } finally {
      setMoving("");
    }
  };

  const columns = [
    {
      key: "title",
      header: "Issue",
      render: (row) => (
        <div className="max-w-sm">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-400">{row.project?.name || "No project"}</p>
        </div>
      ),
    },
    { key: "severity", header: "Severity", render: (row) => <Badge value={row.severity} /> },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge value={row.status}>{STATUS_LABELS[row.status] || row.status}</Badge>,
    },
    { key: "raisedBy", header: "Raised by", render: (row) => row.raisedBy?.name || "—" },
    { key: "assignedTo", header: "Owner", render: (row) => row.assignedTo?.name || "Unassigned" },
    {
      key: "createdAt",
      header: "Reported",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        const done = ["resolved", "closed"].includes(row.status);

        return (
          <div className="flex justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setViewing(row);
              }}
              title="Open the issue"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Eye size={15} />
            </button>

            {/* Picking it up, for something nobody has started on */}
            {row.status === "open" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatus(row, "in_progress");
                }}
                disabled={moving === row._id}
                title="Start work on this"
                className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40"
              >
                <Play size={15} />
              </button>
            )}

            {/* The one this page exists for */}
            {done ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatus(row, "open");
                }}
                disabled={moving === row._id}
                title="Reopen — it is not fixed after all"
                className="rounded-md p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"
              >
                <RotateCcw size={15} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatus(row, "resolved");
                }}
                disabled={moving === row._id}
                title="Mark resolved"
                className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"
              >
                <Check size={15} />
              </button>
            )}

          </div>
        );
      },
    },
  ];

  return (
    <div>
      {/**
        * No Report Issue button, and no edit or delete below.
        *
        * Issues are raised by the people who hit them — an employee on site,
        * an operations manager on a project — and this screen is where the
        * company reads them and says when they are done. An admin typing one
        * in on somebody's behalf produces a record with nobody's account of
        * what happened behind it, and an admin editing or deleting one edits
        * or deletes somebody else's report of their own problem.
        */}
      <PageHeader
        title="Issues"
        subtitle={`${crud.total} issues logged across all projects`}
      />

      <Alert>{crud.error}</Alert>

      {/**
        * Whether anything is on fire, before reading a single row. Counted by
        * the server across every issue — the table below is filtered, these
        * are not, and a tile that agreed with the filter would answer a
        * different question than the one somebody opens this page with.
        */}
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="Open" value={summary.open} tone={summary.open ? "blue" : "slate"} />
          <Tile label="In progress" value={summary.inProgress} tone="amber" />
          <Tile
            label="High or critical"
            value={summary.urgentOpen}
            hint="still open"
            tone={summary.urgentOpen ? "red" : "slate"}
          />
          <Tile
            label="Resolved"
            value={summary.resolved + summary.closed}
            hint={summary.closed ? `${summary.closed} closed` : "and closed"}
            tone="green"
          />
        </div>
      )}

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search issues"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: STATUSES,
            },
            {
              key: "severity",
              value: crud.filters.severity,
              placeholder: "All severities",
              options: SEVERITIES,
            },
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
            },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          // Opening a row reads it; editing is the pencil. A click that lands
          // on a form is how looking something up becomes changing it.
          onRowClick={setViewing}
          emptyTitle="No issues reported"
          emptyMessage="Site problems and blockers logged here stay visible until they are closed."
        />
      </Card>

      <IssueDetail
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        /**
         * Read back off the loaded list, so a row resolved from inside the
         * drawer reads as resolved rather than as it was when it was clicked.
         */
        row={crud.rows.find((r) => r._id === viewing?._id) || viewing}
        onResolve={setStatus}
        busy={Boolean(moving)}
      />

    </div>
  );
}
