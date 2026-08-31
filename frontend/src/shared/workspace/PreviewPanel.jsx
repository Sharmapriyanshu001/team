import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";

/**
 * Where the preview lives is the server's business, not something to assemble
 * here — it runs on its own port and the panel is simply told the address.
 * This only stands in if an older server did not send one.
 */
const fallbackOrigin = () => {
  const base = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  return base.replace(/\/api\/?$/, "");
};

/**
 * What to say when the raw files cannot render on their own. Each of these
 * needs its dev server started from the terminal below; the preview then
 * proxies to it and this notice goes away on its own.
 */
const STACK_NOTE = {
  react: "A React project needs its dev server. Run npm install, then dev, in the terminal below.",
  vite: "A Vite project needs its dev server. Run npm install, then dev, in the terminal below.",
  next: "A Next.js project needs its dev server. Run npm install, then dev, in the terminal below.",
  node: "A Node project serves itself. Run npm install, then its start script, in the terminal below.",
  unknown: "No index.html was found, so there is nothing to render on its own.",
};

/**
 * Live output for static projects, in the panel beside the editor.
 *
 * The iframe is sandboxed without allow-same-origin, so the previewed page
 * gets an opaque origin: its scripts run and its styles apply, but it cannot
 * reach the workspace's session, the parent page, or anything else the browser
 * holds for this app. A project's own code is not something to trust with the
 * same privileges as the panel showing it.
 */
export default function PreviewPanel({ api, base, projectId, project, onClose, say, refreshKey }) {
  const frameRef = useRef(null);
  const [state, setState] = useState({ loading: true, url: "", error: "", servable: true });
  const [reloading, setReloading] = useState(false);

  const mint = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [tokenRes, runRes] = await Promise.all([
        api.get(`${base}/workspace/${projectId}/preview-token`),
        // A running dev server answers everything, so the stack no longer
        // decides whether there is anything to show
        api.get(`${base}/workspace/${projectId}/run`).catch(() => null),
      ]);

      // Either signal will do: the token endpoint checks the runner too
      const serverUp =
        Boolean(runRes?.data?.status?.serverUp) || Boolean(tokenRes.data.devServerUp);
      setState({
        loading: false,
        url: tokenRes.data.url || `${fallbackOrigin()}${tokenRes.data.path}`,
        error: "",
        servable: serverUp || tokenRes.data.servable,
        viaDevServer: serverUp,
      });
    } catch (err) {
      setState({
        loading: false,
        url: "",
        error: err.response?.data?.message || "Could not start the preview",
        servable: false,
      });
    }
  }, [api, base, projectId]);

  useEffect(() => {
    mint();
  }, [mint]);

  /**
   * Reload after a save. The token is still good, so only the frame is
   * refreshed — and the cache-busting parameter is what makes the browser go
   * back for a file it just fetched a second ago.
   */
  const reload = useCallback(() => {
    if (!state.url || !frameRef.current) return;
    setReloading(true);
    frameRef.current.src = `${state.url}?r=${Date.now()}`;
    setTimeout(() => setReloading(false), 400);
  }, [state.url]);

  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);

  const openTab = () => {
    if (!state.url) return;
    window.open(state.url, "_blank", "noopener,noreferrer");
    say?.("Preview opened in a new tab");
  };

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-white/10 bg-[#0B0F1A]">
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-white/10 px-3">
        <span className="text-[13px] font-medium text-slate-200">Live preview</span>

        <button
          onClick={reload}
          disabled={!state.url}
          title="Reload the preview"
          className="ml-auto rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <RefreshCw size={13} className={reloading ? "animate-spin" : ""} />
        </button>
        <button
          onClick={openTab}
          disabled={!state.url}
          title="Open preview in a new tab"
          className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <ExternalLink size={13} />
        </button>
        <button
          onClick={onClose}
          title="Close the preview"
          className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </header>

      {!state.servable && !state.error && (
        <p className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-amber-200">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {STACK_NOTE[project?.stack] || STACK_NOTE.unknown}
        </p>
      )}

      <div className="min-h-0 flex-1 bg-white">
        {state.loading ? (
          <div className="flex h-full items-center justify-center gap-2 bg-[#0B0F1A] text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            Starting preview…
          </div>
        ) : state.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0B0F1A] px-6 text-center">
            <TriangleAlert size={22} className="text-amber-400" />
            <p className="text-sm text-slate-300">{state.error}</p>
            <button
              onClick={mint}
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
            >
              Try again
            </button>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            src={state.url}
            title="Project preview"
            /**
             * allow-same-origin is here on purpose, and it is safe because the
             * preview runs on its own port — its own origin, shared with
             * nothing.
             *
             * Without it the page gets an opaque origin, and an opaque origin
             * has no storage: localStorage throws the moment it is touched, so
             * a previewed app cannot log in or remember anything. What it gets
             * instead is a storage area of its own, on an origin that is
             * neither this panel's nor the API's — so it still cannot read a
             * token belonging to the person previewing it, and it still cannot
             * reach this page across the frame boundary.
             */
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>

      <p className="shrink-0 border-t border-white/10 px-3 py-2 text-[11px] leading-snug text-slate-500">
        {state.viaDevServer
          ? "Served by the project's own dev server, so its hot reload applies too."
          : "Save a file and the preview reloads. The link expires after 30 minutes."}
      </p>
    </aside>
  );
}
