import { useCallback, useEffect, useState } from "react";
import { Download, History, Loader2, Lock, RotateCcw, Save, Trash2, X } from "lucide-react";

const formatSize = (bytes = 0) => {
  if (!bytes) return "0 B";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const formatWhen = (value) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Saves a blob the browser fetched behind the panel's token. */
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * The version history drawer, opened from the workspace header.
 *
 * What the buttons offer follows what the server said this account may do:
 * snapshotting needs canEdit, and rolling back is the admin's alone because it
 * discards whatever everyone else on the project has been doing.
 */
export default function VersionPanel({ api, base, projectId, projectName, onClose, onRestored, say }) {
  const [state, setState] = useState({ loading: true, versions: [], error: "" });
  const [meta, setMeta] = useState({ canRestore: false, canSnapshot: false, currentVersion: 1 });
  const [pending, setPending] = useState([]);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const { data } = await api.get(`${base}/code-projects/${projectId}/versions`);
      setState({ loading: false, versions: data.versions || [], error: "" });
      setMeta({
        canRestore: Boolean(data.canRestore),
        canSnapshot: Boolean(data.canSnapshot),
        currentVersion: data.currentVersion,
        maxVersions: data.maxVersions,
      });
      setPending(data.pendingChanges || []);
    } catch (err) {
      setState({
        loading: false,
        versions: [],
        error: err.response?.data?.message || "Could not load the history",
      });
    }
  }, [api, base, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const snapshot = async () => {
    setBusy("snapshot");
    try {
      const { data } = await api.post(`${base}/code-projects/${projectId}/versions`, {
        label: label.trim(),
        note: note.trim(),
      });
      say?.(data.message || "Version saved", "ok");
      setLabel("");
      setNote("");
      load();
    } catch (err) {
      const message = err.response?.data?.message || "Could not save a version";
      setState((prev) => ({ ...prev, error: message }));
      say?.(message, "error");
    } finally {
      setBusy("");
    }
  };

  const download = async (version) => {
    setBusy(`dl-${version.version}`);
    try {
      const { data } = await api.get(
        `${base}/code-projects/${projectId}/versions/${version.version}/archive`,
        { responseType: "blob" }
      );
      saveBlob(data, `${projectName.replace(/[^a-z0-9]+/gi, "-")}-v${version.version}.zip`);
    } catch {
      say?.("Could not download that snapshot", "error");
    } finally {
      setBusy("");
    }
  };

  const restore = async (version) => {
    const ok = window.confirm(
      `Roll this project back to version ${version.version}?\n\n` +
        `Every file goes back to how it was in that snapshot. The current state ` +
        `is saved as a new version first, so this can be undone.`
    );
    if (!ok) return;

    setBusy(`restore-${version.version}`);
    try {
      const { data } = await api.post(
        `${base}/code-projects/${projectId}/versions/${version.version}/restore`
      );
      say?.(data.message || "Restored", "ok");
      load();
      onRestored?.();
    } catch (err) {
      const message = err.response?.data?.message || "Could not restore that version";
      setState((prev) => ({ ...prev, error: message }));
      say?.(message, "error");
    } finally {
      setBusy("");
    }
  };

  const remove = async (version) => {
    const ok = window.confirm(`Delete version ${version.version}? The snapshot is removed for good.`);
    if (!ok) return;

    setBusy(`del-${version.version}`);
    try {
      const { data } = await api.delete(
        `${base}/code-projects/${projectId}/versions/${version.version}`
      );
      say?.(data.message || "Version deleted", "ok");
      load();
    } catch (err) {
      say?.(err.response?.data?.message || "Could not delete that version", "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-[#0B0F1A]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <History size={14} className="text-slate-400" />
        <span className="text-[13px] font-medium text-slate-200">Version history</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"
          aria-label="Close version history"
        >
          <X size={14} />
        </button>
      </header>

      {state.error && (
        <p className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {state.error}
        </p>
      )}

      {/* take a snapshot */}
      {meta.canSnapshot && (
        <div className="shrink-0 border-b border-white/10 p-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is this version?"
            className="mb-2 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Note (optional)"
            className="mb-2 w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500"
          />

          {pending.length > 0 && (
            <p className="mb-2 text-[11px] text-amber-400/90">
              {pending.length} file{pending.length === 1 ? "" : "s"} changed since the last version
            </p>
          )}

          <button
            onClick={snapshot}
            disabled={busy === "snapshot"}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:bg-white/5 disabled:text-slate-500"
          >
            {busy === "snapshot" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            Save this version
          </button>
        </div>
      )}

      {/* the history */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state.loading ? (
          <p className="flex items-center gap-2 px-2 py-4 text-[13px] text-slate-500">
            <Loader2 size={13} className="animate-spin" />
            Loading history…
          </p>
        ) : (
          state.versions.map((version) => {
            const current = version.version === meta.currentVersion;

            return (
              <div
                key={version.version}
                className={`mb-1.5 rounded-lg border p-2.5 ${
                  current ? "border-blue-500/40 bg-blue-500/5" : "border-white/10"
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                    v{version.version}
                  </span>
                  {version.isOriginal && (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      <Lock size={9} />
                      original
                    </span>
                  )}
                  {current && (
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                      current
                    </span>
                  )}
                </div>

                <p className="truncate text-[13px] font-medium text-slate-200">{version.label}</p>
                {version.note && (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{version.note}</p>
                )}

                <p className="mt-1 text-[11px] text-slate-500">
                  {version.createdByName} · {formatWhen(version.createdAt)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {version.fileCount} files · {formatSize(version.size)}
                  {version.changedFiles?.length > 0 && ` · ${version.changedFiles.length} changed`}
                </p>

                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => download(version)}
                    disabled={busy === `dl-${version.version}`}
                    title="Download this snapshot"
                    className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    {busy === `dl-${version.version}` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                  </button>

                  {meta.canRestore && !current && (
                    <button
                      onClick={() => restore(version)}
                      disabled={busy === `restore-${version.version}`}
                      title="Roll the project back to this version"
                      className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
                    >
                      {busy === `restore-${version.version}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RotateCcw size={12} />
                      )}
                      Restore
                    </button>
                  )}

                  {meta.canRestore && !version.isOriginal && (
                    <button
                      onClick={() => remove(version)}
                      disabled={busy === `del-${version.version}`}
                      title="Delete this snapshot"
                      className="ml-auto rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="shrink-0 border-t border-white/10 px-3 py-2 text-[11px] leading-snug text-slate-500">
        The original upload is version 1 and can never be deleted — however far the files drift,
        that is always here.
      </p>
    </aside>
  );
}
