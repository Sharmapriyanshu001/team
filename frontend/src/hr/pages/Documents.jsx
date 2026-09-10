import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  FileWarning,
  Plus,
} from "lucide-react";

import hrApi from "../hrApi";
import useHrAccess from "../hooks/useHrAccess";
import PaperworkModal from "../components/PaperworkModal";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import {
  Alert,
  Button,
  Card,
  PageHeader,
} from "../../shared/components/ui";

/**
 * Who has handed in what.
 *
 * The point of the screen is the gaps — the person with no PAN on file is the
 * one HR has to chase — so everybody appears whether or not they have given
 * anything, and what is missing is as prominent as what is held.
 *
 * The scans themselves are never listed or linked in bulk. Each one is fetched
 * one at a time, through a route that checks the HR session first, because
 * nothing under uploads/ is reachable any other way.
 */

export default function Documents() {
  const { can } = useHrAccess();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  // Whose paperwork is open in the panel
  const [filling, setFilling] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/documents", {
        params: { search: search || undefined, status: status || undefined },
      })
      .then(({ data: body }) => active && setData(body))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not load documents")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [search, status, reloadKey]);

  /**
   * Opening one paper.
   *
   * The route needs the HR bearer token, which an <a href> cannot send — so
   * the file is fetched, turned into a blob URL and opened. The URL is revoked
   * shortly after: it is a handle to bytes held in this tab, and leaving them
   * around is leaving somebody's Aadhaar scan in memory for the session.
   */
  const openDocument = async (personId, field) => {
    setError("");
    try {
      const response = await hrApi.get(`/hr/documents/${personId}/${field}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(
        err.response?.status === 404
          ? "That document is not on file"
          : "Could not open that document"
      );
    }
  };

  /**
   * One person's file, as a card.
   *
   * A table could only ever print the missing pieces as one comma-separated
   * sentence, which is the least readable form of a list somebody is meant to
   * act on — and it gave equal weight to "PAN number", which is a phone call,
   * and "Salary slip", which is a scan from a previous employer. Grouped and
   * split by kind, the card says what to chase and who to chase it from.
   */
  const columns = [
    {
      key: "person",
      header: "Person",
      render: (row) => {
        const total = row.held.length + row.missing.length;
        const done = row.held.length;
        const pct = total ? Math.round((done / total) * 100) : 0;

        /** Chased by a phone call, or by "send me a photo" — different jobs. */
        const missingNumbers = row.missing.filter((p) => p.kind === "number");
        const missingScans = row.missing.filter((p) => p.kind === "scan");

        return (
          <div className="flex flex-col gap-3 py-1 lg:flex-row lg:items-start lg:gap-5">
            {/* ------------------------------------------ who, and how far */}
            <div className="lg:w-56 lg:shrink-0">
              <p className="font-medium text-slate-900">{row.name}</p>
              <p className="text-xs text-slate-400">
                {row.designation || (row.role || "").replace(/_/g, " ")}
              </p>

              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      row.complete ? "bg-emerald-500" : done ? "bg-blue-500" : "bg-slate-300"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={`text-[11px] font-semibold ${
                    row.complete ? "text-emerald-700" : "text-slate-500"
                  }`}
                >
                  {done}/{total}
                </span>
              </div>
            </div>

            {/* ------------------------------------------------ what is in */}
            <div className="min-w-0 flex-1 space-y-2">
              {row.complete ? (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                  <CheckCircle2 size={13} />
                  Everything is on file
                </p>
              ) : (
                <>
                  {/**
                   * Only what is actually missing. A piece somebody filled in
                   * when their record was created does not appear here at all
                   * — it moves to "on file" below.
                   */}
                  {missingNumbers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Ask them for
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {missingNumbers.map((p) => (
                          <span
                            key={p.field}
                            className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                          >
                            {p.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {missingScans.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Scans still to come
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {missingScans.map((p) => (
                          <span
                            key={p.field}
                            className="rounded-md bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-inset ring-slate-200"
                            title={p.group}
                          >
                            {p.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* -------------------------------------------- what is held */}
              {row.held.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    On file
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.held.map((paper) =>
                      /**
                       * A typed number is text, not a file — there is nothing
                       * to open, so it is not a button. Printing the value
                       * beside it is the point: this is the register somebody
                       * reads a PAN off.
                       */
                      paper.kind === "number" ? (
                        <span
                          key={paper.field}
                          className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"
                        >
                          {paper.label.replace(" number", "")}:{" "}
                          <span className="font-mono">
                            {paper.field === "aadhaarNumber" ? row.aadhaarNumber : row.panNumber}
                          </span>
                        </span>
                      ) : (
                        <button
                          key={paper.field}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocument(row._id, paper.field);
                          }}
                          title={`Open ${paper.label}`}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100"
                        >
                          {paper.label}
                          <ExternalLink size={10} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ---------------------------------------------- the one action */}
            {can("employees", "edit") && (
              <div className="lg:shrink-0">
                <Button
                  variant={row.complete ? "ghost" : row.held.length ? "outline" : "primary"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilling(row);
                  }}
                >
                  {row.complete ? (
                    <>
                      <Plus size={14} />
                      Update
                    </>
                  ) : row.held.length ? (
                    <>
                      <Plus size={14} />
                      Add the rest
                    </>
                  ) : (
                    <>
                      <FilePlus2 size={14} />
                      Fill details
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={
          data
            ? `${data.complete} of ${data.total} complete · ${data.withNothing} with nothing on file`
            : "Identity and employment papers"
        }
      />

      <Alert>{error}</Alert>

      {!loading && data?.withNothing > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {data.withNothing} {data.withNothing === 1 ? "person has" : "people have"} handed in
          nothing at all.
        </div>
      )}

      <Card>
        <Toolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by name, email or designation"
          onFilter={(key, value) => key === "status" && setStatus(value)}
          filters={[
            {
              key: "status",
              value: status,
              placeholder: "Any status",
              options: [
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ],
            },
          ]}
        />

        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          onRowClick={can("employees", "edit") ? setFilling : undefined}
          emptyTitle="Nobody to show"
          emptyMessage="Nothing matches these filters."
        />
      </Card>

      <PaperworkModal
        person={filling}
        onClose={() => setFilling(null)}
        // The register counts what is on file, so it has to be re-read
        onSaved={() => setReloadKey((n) => n + 1)}
      />

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <FileWarning size={13} className="mt-0.5 shrink-0" />
        Papers are uploaded when somebody is added or edited from the admin panel. Each scan opens
        one at a time through a route that checks your session — none of them is a link anybody
        could follow without one.
      </p>
    </div>
  );
}
