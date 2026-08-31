import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, CircleStop, Loader2, Plus, Terminal, Trash2, X } from "lucide-react";

const POLL_MS = 1000;
const MAX_HISTORY = 60;

const STATUS_TONE = {
  running: "text-emerald-400",
  finished: "text-slate-400",
  stopped: "text-slate-500",
  error: "text-red-400",
  idle: "text-slate-500",
};

const LINE_TONE = {
  err: "text-red-300",
  system: "text-blue-300",
  cmd: "text-emerald-300",
  out: "text-slate-300",
};

/**
 * The workspace terminal, with tabs.
 *
 * Tabs because one shell could not do the obvious thing: a project with a
 * backend and a frontend needs both running at once, and a single slot meant
 * starting the second stopped the first. Each tab keeps its own directory, its
 * own process and its own output — `cd backend` in one leaves the other alone.
 *
 * A real prompt: whatever is typed is what runs. The buttons across the top
 * are shortcuts for the scripts package.json declares; they save typing the
 * obvious thing without being the only thing on offer.
 */
export default function TerminalPanel({ api, base, projectId, canRun, onServerUp, say }) {
  const [meta, setMeta] = useState({ scripts: {}, rootDir: "", npmAvailable: true });
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState({ status: "idle", serverUp: false, cwd: "." });
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);

  // Up and down walk back through what has been typed, as a shell does
  const [history, setHistory] = useState([]);
  const [historyAt, setHistoryAt] = useState(-1);

  const cursor = useRef(0);
  const bottom = useRef(null);
  const inputRef = useRef(null);
  const serverSeen = useRef(new Set());

  const isRunning = status.status === "running";

  /* ------------------------------------------------------------ loading */

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get(`${base}/workspace/${projectId}/run`, {
        // Scripts follow the tab, so the buttons match where you are standing
        params: activeId ? { session: activeId } : undefined,
      });
      setMeta({
        scripts: data.scripts || {},
        rootDir: data.rootDir || "",
        npmAvailable: data.npmAvailable !== false,
      });
      setSessions(data.sessions || []);
      setActiveId((current) =>
        current && (data.sessions || []).some((s) => s.id === current)
          ? current
          : data.sessions?.[0]?.id || ""
      );
    } catch {
      /* the poll will try again */
    }
    // activeId is a dependency because the scripts come back per tab
  }, [api, base, projectId, activeId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /* ------------------------------------------------------------- polling */

  const poll = useCallback(async () => {
    if (!activeId) return;

    try {
      const { data } = await api.get(`${base}/workspace/${projectId}/run/logs`, {
        params: { since: cursor.current, session: activeId },
      });

      if (data.lines?.length) {
        setLines((prev) => [...prev, ...data.lines].slice(-1000));
        cursor.current = data.next;
      }
      if (data.status) setStatus(data.status);

      // Any tab coming up with a server is worth telling the preview about
      if (data.status?.serverUp && !serverSeen.current.has(activeId)) {
        serverSeen.current.add(activeId);
        onServerUp?.(data.status.port);
      }
      if (!data.status?.serverUp) serverSeen.current.delete(activeId);
    } catch {
      /* a dropped poll is not worth a message; the next one will do */
    }
  }, [api, base, projectId, activeId, onServerUp]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  // Tabs keep their own scrollback, so switching starts the cursor over
  useEffect(() => {
    cursor.current = 0;
    setLines([]);
  }, [activeId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  /* ------------------------------------------------------------- actions */

  const runCommand = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, MAX_HISTORY));
    setHistoryAt(-1);
    setCommand("");
    setBusy(true);

    try {
      const { data } = await api.post(`${base}/workspace/${projectId}/run`, {
        command: trimmed,
        session: activeId,
      });
      if (data.status) setStatus(data.status);
    } catch (err) {
      const message = err.response?.data?.message || "Could not run that";
      // Show the refusal in the terminal, where the command was typed
      setLines((prev) => [...prev, { n: `local-${Date.now()}`, stream: "err", text: message }]);
      say?.(message, "error");
    } finally {
      setBusy(false);
      poll();
      loadSessions();
    }
  };

  /** While something runs, the prompt talks to it instead of starting anything. */
  const answer = async (text) => {
    setCommand("");
    try {
      await api.post(`${base}/workspace/${projectId}/run/input`, { text, session: activeId });
    } catch (err) {
      say?.(err.response?.data?.message || "Could not send that", "error");
    } finally {
      poll();
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (isRunning) answer(command);
    else runCommand(command);
  };

  const halt = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`${base}/workspace/${projectId}/run`, {
        params: { session: activeId },
      });
      if (data.status) setStatus(data.status);
    } catch (err) {
      say?.(err.response?.data?.message || "Could not stop it", "error");
    } finally {
      setBusy(false);
      poll();
      loadSessions();
    }
  };

  const addTab = async () => {
    try {
      const { data } = await api.post(`${base}/workspace/${projectId}/run/session`, {});
      await loadSessions();
      if (data.session?.id) setActiveId(data.session.id);
      inputRef.current?.focus();
    } catch (err) {
      say?.(err.response?.data?.message || "Could not open another terminal", "error");
    }
  };

  const closeTab = async (id, e) => {
    e?.stopPropagation();

    const tab = sessions.find((s) => s.id === id);
    if (tab?.status === "running") {
      const ok = window.confirm(`"${tab.label}" is still running here. Close it anyway?`);
      if (!ok) return;
    }

    try {
      const { data } = await api.delete(`${base}/workspace/${projectId}/run/session/${id}`);
      setSessions(data.sessions || []);
      if (id === activeId) setActiveId(data.sessions?.[0]?.id || "");
    } catch (err) {
      say?.(err.response?.data?.message || "Could not close that terminal", "error");
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyAt + 1, history.length - 1);
      if (next >= 0) {
        setHistoryAt(next);
        setCommand(history[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = historyAt - 1;
      setHistoryAt(next);
      setCommand(next >= 0 ? history[next] : "");
    } else if (e.key === "c" && e.ctrlKey && isRunning) {
      // Ctrl+C where a terminal expects it
      e.preventDefault();
      halt();
    }
  };

  const scriptNames = Object.keys(meta.scripts);

  return (
    <div className="flex h-full flex-col bg-[#080B14]">
      {/* tabs */}
      <div className="flex h-8 shrink-0 items-stretch border-b border-white/10">
        <span className="flex shrink-0 items-center gap-1.5 px-3 text-[11px] uppercase tracking-wide text-slate-500">
          <Terminal size={12} />
          Terminal
        </span>

        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sessions.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 pl-3 pr-2 text-[12px] transition-colors ${
                  active ? "bg-[#0B0F1A] text-slate-200" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab.status === "running" && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                )}
                <span className="max-w-[10rem] truncate">{tab.cwd === "." ? tab.name : tab.cwd}</span>
                {tab.serverUp && <span className="text-[10px] text-emerald-400">:{tab.port}</span>}
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => closeTab(tab.id, e)}
                    className="rounded p-0.5 text-slate-600 opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"
                    aria-label={`Close ${tab.name}`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}

          {canRun && (
            <button
              onClick={addTab}
              title="Open another terminal — run your backend and frontend side by side"
              className="flex shrink-0 items-center px-2.5 text-slate-500 hover:bg-white/5 hover:text-white"
            >
              <Plus size={13} />
            </button>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-2 px-3 text-[11px]">
          <span className={STATUS_TONE[status.status] || "text-slate-500"}>
            {status.label ? `${status.label.slice(0, 34)} — ${status.status}` : status.status}
          </span>
          {lines.length > 0 && (
            <button
              onClick={() => setLines([])}
              title="Clear the view — whatever is running keeps running"
              className="rounded p-1 text-slate-600 hover:bg-white/10 hover:text-slate-300"
            >
              <Trash2 size={11} />
            </button>
          )}
        </span>
      </div>

      {/* shortcuts */}
      {canRun && (
        <div className="flex h-8 shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-3">
          {["npm install", ...scriptNames.map((n) => `npm run ${n}`)].map((shortcut) => (
            <button
              key={shortcut}
              onClick={() => runCommand(shortcut)}
              disabled={isRunning || busy}
              title={`Runs: ${shortcut}`}
              className="rounded border border-white/10 px-2 py-0.5 text-[12px] text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              {shortcut}
            </button>
          ))}

          {isRunning && (
            <button
              onClick={halt}
              disabled={busy}
              className="flex items-center gap-1 rounded border border-red-500/30 px-2 py-0.5 text-[12px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              <CircleStop size={11} />
              Stop
            </button>
          )}
        </div>
      )}

      {/* output */}
      <div
        className="min-h-0 flex-1 cursor-text overflow-auto px-3 py-1.5 font-mono text-[12px] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {!canRun ? (
          <p className="text-slate-500">You do not have permission to run this project.</p>
        ) : (
          <>
            {!lines.length && (
              <p className="text-slate-600">
                Type any command and press Enter. Use <span className="text-slate-400">cd</span> to
                move around, and the <span className="text-slate-400">+</span> above to open another
                terminal — one for the backend, one for the frontend.
                {!meta.npmAvailable && " (npm was not found on the server.)"}
              </p>
            )}
            {lines.map((line) => (
              <p key={line.n} className={`whitespace-pre-wrap ${LINE_TONE[line.stream] || LINE_TONE.out}`}>
                {line.text}
              </p>
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>

      {/* prompt */}
      {canRun && (
        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3 py-1.5">
          <span className="shrink-0 font-mono text-[12px] text-emerald-400">
            {isRunning ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={13} />}
          </span>
          <span className="shrink-0 font-mono text-[12px] text-slate-600">{status.cwd || "."}</span>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            placeholder={
              isRunning
                ? "Answer the running command, or Ctrl+C to stop it"
                : "cd backend     npm install     npm run dev     git status"
            }
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-slate-200 outline-none placeholder:text-slate-600"
          />
        </form>
      )}
    </div>
  );
}
