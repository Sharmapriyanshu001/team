import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, Paperclip, RefreshCw, Upload, X } from "lucide-react";

import adminApi from "../adminApi";

const MAX_MB = 8;

const formatSize = (bytes = 0) => {
  if (!bytes) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const isImage = (type = "", name = "") =>
  type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(name);

/**
 * One document on a staff record — an Aadhaar side, a PAN side, an experience
 * letter.
 *
 * Three states, and the difference between the last two is the point: nothing
 * on file yet, something already stored on the server, and something picked in
 * this browser that has not been saved. An edit form that showed a stored
 * Aadhaar scan and a newly chosen one the same way would leave the admin
 * unsure whether pressing Save was going to change anything.
 *
 * Stored documents are fetched through the api rather than linked to, because
 * nothing under uploads/ is served without a token — a plain <a href> would
 * open a 401.
 */
export default function DocumentUpload({
  label,
  name,
  hint,
  required,
  file,
  stored,
  recordId,
  resource,
  onPick,
  error,
}) {
  const inputRef = useRef(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");

  // A thumbnail of what was just picked. Derived rather than kept in state, so
  // choosing a file does not cost a second render to show it.
  const preview = useMemo(
    () => (file && isImage(file.type, file.name) ? URL.createObjectURL(file) : ""),
    [file]
  );

  // An object URL held past its usefulness leaks for the life of the tab
  useEffect(() => {
    if (!preview) return undefined;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    onPick(name, chosen);
  };

  const clear = () => {
    onPick(name, null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Open what is already on the server, in a tab. */
  const view = async () => {
    setOpening(true);
    setOpenError("");
    try {
      const { data } = await adminApi.get(
        `/admin/${resource}/${recordId}/documents/${name}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener");
      // Long enough for the new tab to have loaded it; the tab keeps its own
      // reference, so revoking here does not close what is already open
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setOpenError("Could not open that document");
    } finally {
      setOpening(false);
    }
  };

  const has = Boolean(file || stored?.storedName);
  const tone = error
    ? "border-red-300 bg-red-50/40"
    : has
      ? "border-blue-200 bg-blue-50/40"
      : "border-slate-300 bg-white";

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-blue-600"> *</span>}
      </label>

      <div className={`rounded-lg border border-dashed p-3 transition-colors ${tone}`}>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,image/*,application/pdf"
          onChange={pick}
        />

        {!has ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 py-3 text-slate-500 hover:text-blue-600"
          >
            <Upload size={18} />
            <span className="text-xs font-medium">Choose a photo or PDF</span>
            <span className="text-[11px] text-slate-400">JPG, PNG or PDF · up to {MAX_MB} MB</span>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {preview ? (
              <img
                src={preview}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-white text-slate-400 ring-1 ring-slate-200">
                {file ? <Paperclip size={16} /> : <FileText size={16} />}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-800">
                {file ? file.name : stored?.originalName || "On file"}
              </p>
              <p className="text-[11px] text-slate-400">
                {file
                  ? `${formatSize(file.size)} · not saved yet`
                  : `${formatSize(stored?.size)} · already on file`}
              </p>
              {openError && <p className="text-[11px] text-red-600">{openError}</p>}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* Only what the server already holds can be opened — a file
                  picked a moment ago is on this machine, not on the record */}
              {!file && stored?.storedName && recordId && (
                <button
                  type="button"
                  onClick={view}
                  disabled={opening}
                  title="View"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-blue-600 disabled:opacity-50"
                >
                  <Eye size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                title={stored?.storedName && !file ? "Replace" : "Choose another"}
                className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-blue-600"
              >
                <RefreshCw size={14} />
              </button>
              {file && (
                <button
                  type="button"
                  onClick={clear}
                  title="Remove"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-1 text-[11px] text-red-600">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
      )}
    </div>
  );
}
