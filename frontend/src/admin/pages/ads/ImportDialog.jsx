import { useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";

import adminApi from "../../adminApi";
import Modal from "../../../shared/components/Modal";
import { Alert, Button, Field, Select, Textarea } from "../../../shared/components/ui";
import { FIELD_LABELS, buildRows, guessColumns, parseCsv } from "./csv";

/**
 * Import a day-by-day export from Meta or Google.
 *
 * Three steps on purpose: choose the file, check the columns it guessed, see
 * what will happen before it happens. The middle step is the one that earns
 * its keep — an export whose spend column was read as "Reach" imports a month
 * of nonsense, and the only moment that is cheap to catch is before the write.
 */
export default function ImportDialog({ open, accountId, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const [pasted, setPasted] = useState("");

  const reset = () => {
    setRows(null);
    setHeaders([]);
    setMapping({});
    setError("");
    setReport(null);
    setPasted("");
  };

  const read = (text) => {
    setError("");
    setReport(null);

    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setError("That does not look like a CSV with a header row and at least one row of data.");
      return;
    }

    const [head, ...body] = parsed;
    setHeaders(head);
    setRows(body);
    setMapping(guessColumns(head));
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    read(await file.text());
    // Let the same file be chosen again after a reset
    event.target.value = "";
  };

  const missing = FIELD_LABELS.filter(
    ([field, , required]) => required && mapping[field] === undefined
  ).map(([, label]) => label);

  const preview = rows && missing.length === 0 ? buildRows(rows.slice(0, 5), mapping) : [];

  const run = async () => {
    setImporting(true);
    setError("");
    try {
      const { data } = await adminApi.post(`/admin/ads/accounts/${accountId}/import`, {
        rows: buildRows(rows, mapping),
      });
      setReport(data.report);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || "Could not import that file");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Import spend data"
      subtitle="A day-by-day export from Meta Ads Manager or Google Ads"
      size="lg"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        report ? (
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={run}
              loading={importing}
              disabled={!rows || missing.length > 0}
            >
              Import {rows ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
            </Button>
          </>
        )
      }
    >
      <Alert>{error}</Alert>

      {report ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-slate-100">
            {[
              ["Imported", report.imported],
              ["Updated", report.updated],
              ["Skipped", report.skipped.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3 text-center">
                <p className="text-xl font-semibold tabular-nums text-slate-900">{value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {report.campaignsCreated.length > 0 && (
            <div className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-xs font-medium text-slate-700">
                {report.campaignsCreated.length} new campaign
                {report.campaignsCreated.length === 1 ? "" : "s"} created
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {report.campaignsCreated.join(", ")}
              </p>
            </div>
          )}

          {report.skipped.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
              <p className="text-xs font-medium text-amber-900">
                {report.skipped.length} row(s) could not be read
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                {report.skipped.slice(0, 8).map((row) => (
                  <li key={row.row}>
                    Row {row.row} — {row.reason}
                  </li>
                ))}
                {report.skipped.length > 8 && <li>…and {report.skipped.length - 8} more</li>}
              </ul>
            </div>
          )}
        </div>
      ) : !rows ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center hover:border-blue-400 hover:bg-blue-50/40">
            <Upload size={24} className="text-slate-400" />
            <span className="mt-2 text-sm font-medium text-slate-700">Choose a CSV file</span>
            <span className="mt-0.5 text-xs text-slate-400">
              Meta: Ads Manager → Reports → Export. Google: Campaigns → Download → CSV.
            </span>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          </label>

          <div className="text-center text-xs text-slate-400">or paste it</div>

          <Field label="">
            <Textarea
              rows={4}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Campaign name,Day,Amount spent,Impressions,Link clicks,Results&#10;Brand,2026-09-01,1250,40000,820,18"
              className="font-mono text-xs"
            />
          </Field>
          {pasted.trim() && (
            <Button variant="outline" onClick={() => read(pasted)} className="w-full">
              <FileSpreadsheet size={15} />
              Read this
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Which column is which
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELD_LABELS.map(([field, label, required]) => (
                <Field key={field} label={label} required={required}>
                  <Select
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((current) => {
                        const next = { ...current };
                        if (e.target.value === "") delete next[field];
                        else next[field] = Number(e.target.value);
                        return next;
                      })
                    }
                    options={headers.map((header, index) => ({
                      value: index,
                      label: header || `Column ${index + 1}`,
                    }))}
                    placeholder="Not in this file"
                  />
                </Field>
              ))}
            </div>
          </div>

          {missing.length > 0 && (
            <Alert>
              Still need a column for: {missing.join(", ")}. Pick them above, or the import cannot
              run.
            </Alert>
          )}

          {preview.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                First few rows, as they will be read
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
                      <th className="px-3 py-2">Campaign</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Spend</th>
                      <th className="px-3 py-2 text-right">Impr.</th>
                      <th className="px-3 py-2 text-right">Clicks</th>
                      <th className="px-3 py-2 text-right">Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, index) => (
                      <tr key={index} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-slate-900">{row.campaign || "—"}</td>
                        <td
                          className={`px-3 py-1.5 ${row.date ? "text-slate-600" : "text-red-600"}`}
                        >
                          {row.date || "unreadable"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.spend}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.impressions}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.clicks}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{row.conversions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {rows.length} row{rows.length === 1 ? "" : "s"} in the file. A day already recorded
                is replaced, not added to — so re-importing a corrected export is safe.
              </p>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={reset}>
            Choose a different file
          </Button>
        </div>
      )}
    </Modal>
  );
}
