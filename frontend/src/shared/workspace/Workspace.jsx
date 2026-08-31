import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import {
  ArrowLeft,
  CircleAlert,
  Eye,
  FileWarning,
  History,
  Loader2,
  Lock,
  Save,
  Terminal,
  X,
} from "lucide-react";

import "./monacoSetup";
import FileExplorer from "./FileExplorer";
import VersionPanel from "./VersionPanel";
import TerminalPanel from "./TerminalPanel";
import PreviewPanel from "./PreviewPanel";

const MAX_TABS = 12;

const formatSize = (bytes = 0) => {
  if (!bytes) return "0 B";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/**
 * The browser workspace: file tree on the left, editor in the middle, an
 * output strip along the bottom. Mounted by all three panels with their own
 * api instance and base path.
 *
 * Everything this screen decides — which buttons appear, whether the editor is
 * writable — follows what the server said about this project. The server
 * re-checks on every read and every save regardless, so a tampered client
 * gains nothing.
 */
export default function Workspace({ api, base, backTo }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [tree, setTree] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Open files, keyed by path. Each holds the saved text and the current text,
  // which is what makes "unsaved" a fact rather than a flag someone must set.
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [opening, setOpening] = useState("");
  const [saving, setSaving] = useState(false);
  const [log, setLog] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Bumped on every successful save; the preview panel watches it and reloads
  const [previewKey, setPreviewKey] = useState(0);

  const editorRef = useRef(null);

  const say = useCallback((text, tone = "info") => {
    setLog((prev) => [...prev.slice(-60), { text, tone, at: new Date() }]);
  }, []);

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      api.get(`${base}/code-projects/${id}`),
      api.get(`${base}/code-projects/${id}/tree`),
    ])
      .then(([detail, treeRes]) => {
        if (!active) return;
        setProject(detail.data.item);
        setTree(treeRes.data.tree || []);
        setTruncated(Boolean(treeRes.data.truncated));
        setError("");
        say(`Opened "${detail.data.item.name}" — ${detail.data.item.fileCount} files`);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.response?.data?.message || "Could not open this workspace");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base, id, say]);

  /* ------------------------------------------------------------ warn on exit */

  const dirtyCount = tabs.filter((t) => t.content !== t.saved).length;

  useEffect(() => {
    if (!dirtyCount) return undefined;

    // The browser's own guard, for a tab close or a refresh
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  /* --------------------------------------------------------------- tabs */

  const activeTab = tabs.find((t) => t.path === activePath) || null;

  /** Jump the editor to a line, used when a search hit is clicked. */
  const revealLine = useCallback((line) => {
    if (!line || !editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
  }, []);

  const openFile = useCallback(
    async (node, line) => {
      const existing = tabs.find((t) => t.path === node.path);
      if (existing) {
        setActivePath(node.path);
        // The editor for this tab is already mounted, so the jump lands now
        if (line) setTimeout(() => revealLine(line), 0);
        return;
      }

      setOpening(node.path);
      try {
        const { data } = await api.get(`${base}/workspace/${id}/file`, {
          params: { path: node.path },
        });

        setTabs((prev) => {
          const next = [
            ...prev,
            {
              path: data.path,
              name: data.name,
              language: data.language,
              saved: data.content,
              content: data.content,
              size: data.size,
              binary: Boolean(data.binary),
              tooLarge: Boolean(data.tooLarge),
              canEdit: Boolean(data.canEdit),
            },
          ];
          // Keep the strip readable — the oldest clean tab makes way
          if (next.length <= MAX_TABS) return next;
          const victim = next.findIndex((t) => t.content === t.saved && t.path !== data.path);
          if (victim === -1) return next;
          return next.filter((_, i) => i !== victim);
        });
        setActivePath(data.path);

        // Monaco mounts on the next paint, so the jump waits for it
        if (line) setTimeout(() => revealLine(line), 120);

        if (data.binary) say(`${node.path} is a binary file — not shown`, "warn");
        else if (data.tooLarge) say(`${node.path} is too large to open (${formatSize(data.size)})`, "warn");
      } catch (err) {
        say(err.response?.data?.message || `Could not open ${node.path}`, "error");
      } finally {
        setOpening("");
      }
    },
    [api, base, id, tabs, say, revealLine]
  );

  const closeTab = (path) => {
    const tab = tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.saved) {
      const ok = window.confirm(`"${tab.name}" has unsaved changes. Close it anyway?`);
      if (!ok) return;
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (path === activePath) setActivePath(next[next.length - 1]?.path || "");
      return next;
    });
  };

  /* --------------------------------------------------------------- save */

  const save = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab || tab.content === tab.saved || !tab.canEdit) return;

    setSaving(true);
    try {
      const { data } = await api.put(`${base}/workspace/${id}/file`, {
        path: tab.path,
        content: tab.content,
      });

      // Only what the server accepted becomes the new baseline
      setTabs((prev) =>
        prev.map((t) => (t.path === tab.path ? { ...t, saved: t.content, size: data.size } : t))
      );
      say(`Saved ${tab.path} (${formatSize(data.size)})`, "ok");

      // The whole point of the preview: change, save, see it
      setPreviewKey((key) => key + 1);
    } catch (err) {
      say(err.response?.data?.message || `Could not save ${tab.path}`, "error");
    } finally {
      setSaving(false);
    }
  }, [api, base, id, tabs, activePath, say]);

  // Ctrl/Cmd+S anywhere on the page, not only inside the editor
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  /* --------------------------------------------------- file management */

  const refreshTree = useCallback(async () => {
    try {
      const { data } = await api.get(`${base}/code-projects/${id}/tree`);
      setTree(data.tree || []);
      setTruncated(Boolean(data.truncated));
    } catch {
      say("Could not refresh the file tree", "warn");
    }
  }, [api, base, id, say]);

  const create = useCallback(
    async (kind, parent) => {
      const name = window.prompt(
        `New ${kind} in ${parent || "the project root"}:`,
        kind === "file" ? "untitled.js" : "new-folder"
      );
      if (name === null) return;

      try {
        const { data } = await api.post(`${base}/workspace/${id}/${kind}`, {
          parent: parent || "",
          name: name.trim(),
        });
        say(`Created ${data.path}`, "ok");
        await refreshTree();
        // A new file opens straight away — that is what you wanted it for
        if (kind === "file") await openFile({ path: data.path, name: data.name });
      } catch (err) {
        say(err.response?.data?.message || `Could not create that ${kind}`, "error");
      }
    },
    [api, base, id, say, refreshTree, openFile]
  );

  const rename = useCallback(
    async (node) => {
      const name = window.prompt(`Rename "${node.name}" to:`, node.name);
      if (name === null || name.trim() === node.name) return;

      try {
        const { data } = await api.patch(`${base}/workspace/${id}/entry`, {
          path: node.path,
          name: name.trim(),
        });
        say(`Renamed to ${data.path}`, "ok");

        // A renamed file is a different path — the open tab must follow it, or
        // the next save would write to a name that no longer exists.
        setTabs((prev) =>
          prev.map((t) =>
            t.path === node.path ? { ...t, path: data.path, name: data.name } : t
          )
        );
        setActivePath((current) => (current === node.path ? data.path : current));

        await refreshTree();
      } catch (err) {
        say(err.response?.data?.message || "Could not rename that", "error");
      }
    },
    [api, base, id, say, refreshTree]
  );

  const remove = useCallback(
    async (node) => {
      const ok = window.confirm(
        node.type === "folder"
          ? `Delete the folder "${node.name}" and everything inside it?`
          : `Delete "${node.name}"?`
      );
      if (!ok) return;

      try {
        const { data } = await api.delete(`${base}/workspace/${id}/entry`, {
          params: { path: node.path },
        });
        say(`Deleted ${data.path}`, "ok");

        // Close anything that was open from under the deleted path. Computed
        // outside the state updater, which React may run more than once.
        const gone = (p) => p === node.path || p.startsWith(`${node.path}/`);
        const surviving = tabs.filter((t) => !gone(t.path));

        setTabs(surviving);
        if (gone(activePath)) setActivePath(surviving[surviving.length - 1]?.path || "");

        await refreshTree();
      } catch (err) {
        say(err.response?.data?.message || "Could not delete that", "error");
      }
    },
    [api, base, id, say, refreshTree, tabs, activePath]
  );

  const runSearch = useCallback(
    async (query) => {
      if (!query || query.length < 2) {
        say("Search for at least two characters", "warn");
        return;
      }

      setSearching(true);
      try {
        const { data } = await api.get(`${base}/workspace/${id}/search`, {
          params: { q: query },
        });
        setSearchResults(data);
        say(`"${query}" — ${data.results.length} match${data.results.length === 1 ? "" : "es"} in ${data.files} file${data.files === 1 ? "" : "s"}`);
      } catch (err) {
        say(err.response?.data?.message || "Search failed", "error");
      } finally {
        setSearching(false);
      }
    },
    [api, base, id, say]
  );

  /**
   * A rollback replaced every file on disk. Anything open is now showing text
   * that no longer exists, so the tree and each tab are re-read rather than
   * left to look current — a stale editor that still saves would write the old
   * version straight back over the restored one.
   */
  const reloadAfterRestore = useCallback(async () => {
    try {
      const [detail, treeRes] = await Promise.all([
        api.get(`${base}/code-projects/${id}`),
        api.get(`${base}/code-projects/${id}/tree`),
      ]);
      setProject(detail.data.item);
      setTree(treeRes.data.tree || []);
      setTruncated(Boolean(treeRes.data.truncated));

      const open = tabs.map((t) => t.path);
      const refreshed = [];
      let dropped = 0;

      for (const p of open) {
        try {
          const { data } = await api.get(`${base}/workspace/${id}/file`, { params: { path: p } });
          refreshed.push({
            path: data.path,
            name: data.name,
            language: data.language,
            saved: data.content,
            content: data.content,
            size: data.size,
            binary: Boolean(data.binary),
            tooLarge: Boolean(data.tooLarge),
            canEdit: Boolean(data.canEdit),
          });
        } catch {
          // The restored version simply may not have this file
          dropped += 1;
        }
      }

      setTabs(refreshed);
      if (!refreshed.some((t) => t.path === activePath)) {
        setActivePath(refreshed[refreshed.length - 1]?.path || "");
      }

      say(
        `Reloaded from version ${detail.data.item.currentVersion}` +
          (dropped ? ` — ${dropped} open file${dropped === 1 ? "" : "s"} no longer exist` : ""),
        "ok"
      );
    } catch {
      say("Restored, but the workspace could not be reloaded — refresh the page", "warn");
    }
  }, [api, base, id, tabs, activePath, say]);

  const leave = () => {
    if (dirtyCount) {
      const ok = window.confirm(
        `${dirtyCount} file${dirtyCount === 1 ? "" : "s"} still ${
          dirtyCount === 1 ? "has" : "have"
        } unsaved changes. Leave anyway?`
      );
      if (!ok) return;
    }
    navigate(backTo);
  };

  /* -------------------------------------------------------------- render */

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0B0F1A] text-slate-400">
        <Loader2 size={18} className="mr-2 animate-spin text-blue-500" />
        Opening workspace…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#0B0F1A] px-6 text-center">
        <CircleAlert size={26} className="text-red-400" />
        <p className="text-sm text-slate-300">{error}</p>
        <button
          onClick={() => navigate(backTo)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
        >
          Back to my projects
        </button>
      </div>
    );
  }

  const canEditProject = Boolean(project?.myAccess?.canEdit ?? true);
  const canRunProject = Boolean(project?.myAccess?.canRun ?? true);

  return (
    <div className="flex h-screen flex-col bg-[#0B0F1A]">
      {/* ------------------------------------------------------------ top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <button
          onClick={leave}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{project?.name}</p>
        </div>

        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
          {project?.stack}
        </span>

        {!canEditProject && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/20">
            <Lock size={10} />
            read only
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="text-xs text-amber-400">
              {dirtyCount} unsaved
            </span>
          )}

          <button
            onClick={save}
            disabled={!activeTab || activeTab.content === activeTab.saved || !activeTab.canEdit || saving}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-white/5 disabled:text-slate-500"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>

          <button
            onClick={() => setHistoryOpen((open) => !open)}
            title="Version history"
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              historyOpen
                ? "border-blue-500 bg-blue-600/20 text-blue-200"
                : "border-white/10 text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <History size={13} />
            v{project?.currentVersion ?? 1}
          </button>

          <button
            onClick={() => setPreviewOpen((open) => !open)}
            disabled={!canRunProject}
            title={
              canRunProject
                ? "Show the project's output"
                : "You do not have permission to preview this project"
            }
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              previewOpen
                ? "border-blue-500 bg-blue-600/20 text-blue-200"
                : "border-white/10 text-slate-300 hover:bg-white/5 hover:text-white"
            } disabled:border-white/10 disabled:text-slate-600 disabled:hover:bg-transparent`}
          >
            <Eye size={13} />
            Preview
          </button>
        </div>
      </header>

      {/* --------------------------------------------------------- main body */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-white/10">
          <FileExplorer
            tree={tree}
            activePath={activePath}
            onOpen={openFile}
            truncated={truncated}
            dirtyPaths={new Set(tabs.filter((t) => t.content !== t.saved).map((t) => t.path))}
            canCreateDelete={Boolean(project?.myAccess?.canCreateDelete ?? true)}
            onCreate={create}
            onRename={rename}
            onDelete={remove}
            onSearch={runSearch}
            searchResults={searchResults}
            searching={searching}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {/* tab strip */}
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-white/10 bg-[#0B0F1A]">
            {tabs.map((tab) => {
              const dirty = tab.content !== tab.saved;
              const active = tab.path === activePath;

              return (
                <div
                  key={tab.path}
                  className={`group flex shrink-0 items-center gap-2 border-r border-white/10 pl-3 pr-2 text-[13px] transition-colors ${
                    active
                      ? "bg-[#12172a] text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <button
                    onClick={() => setActivePath(tab.path)}
                    title={tab.path}
                    className="max-w-[14rem] truncate py-1"
                  >
                    {tab.name}
                  </button>
                  <button
                    onClick={() => closeTab(tab.path)}
                    className="rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"
                    aria-label={`Close ${tab.name}`}
                  >
                    {dirty ? (
                      <span className="block h-2 w-2 rounded-full bg-amber-400 group-hover:hidden" />
                    ) : null}
                    <X size={12} className={dirty ? "hidden group-hover:block" : "block"} />
                  </button>
                </div>
              );
            })}

            {opening && (
              <span className="flex items-center gap-1.5 px-3 text-[13px] text-slate-500">
                <Loader2 size={12} className="animate-spin" />
                opening…
              </span>
            )}
          </div>

          {/* editor */}
          <div className="min-h-0 flex-1">
            {!activeTab ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                <FileWarning size={26} className="opacity-40" />
                <p className="text-sm">Pick a file on the left to open it.</p>
                <p className="text-xs">Ctrl+S saves. No download, no VS Code needed.</p>
              </div>
            ) : activeTab.binary || activeTab.tooLarge ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-500">
                <FileWarning size={26} className="opacity-40" />
                <p className="text-sm text-slate-300">
                  {activeTab.binary
                    ? "This is a binary file."
                    : `This file is ${formatSize(activeTab.size)} — too large to edit here.`}
                </p>
                <p className="text-xs">{activeTab.path}</p>
              </div>
            ) : (
              <Editor
                key={activeTab.path}
                theme="vs-dark"
                language={activeTab.language}
                value={activeTab.content}
                onChange={(value) =>
                  setTabs((prev) =>
                    prev.map((t) => (t.path === activeTab.path ? { ...t, content: value ?? "" } : t))
                  )
                }
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                options={{
                  readOnly: !activeTab.canEdit,
                  fontSize: 13,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  renderWhitespace: "selection",
                }}
                loading={
                  <span className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 size={14} className="animate-spin" />
                    Loading editor…
                  </span>
                }
              />
            )}
          </div>

          {/* the bottom strip: what the workspace itself is doing, then the
              project's own terminal */}
          <div className="flex h-56 shrink-0 flex-col border-t border-white/10">
            <div className="h-16 shrink-0 overflow-auto bg-[#0B0F1A] px-3 py-1.5 font-mono text-[12px] leading-relaxed">
              {log.map((entry, i) => (
                <p
                  key={i}
                  className={
                    entry.tone === "error"
                      ? "text-red-400"
                      : entry.tone === "warn"
                        ? "text-amber-400"
                        : entry.tone === "ok"
                          ? "text-emerald-400"
                          : "text-slate-400"
                  }
                >
                  <span className="text-slate-600">
                    {entry.at.toLocaleTimeString("en-IN", { hour12: false })}{" "}
                  </span>
                  {entry.text}
                </p>
              ))}
            </div>

            <div className="min-h-0 flex-1 border-t border-white/10">
              <TerminalPanel
                api={api}
                base={base}
                projectId={id}
                canRun={canRunProject}
                say={say}
                /**
                 * A dev server coming up changes where the preview should
                 * point. Opening the panel and refreshing it here means the
                 * output appears the moment it can, rather than when somebody
                 * thinks to look.
                 */
                onServerUp={(port) => {
                  say(`Dev server is up on port ${port} — preview is live`, "ok");
                  setPreviewOpen(true);
                  setPreviewKey((key) => key + 1);
                }}
              />
            </div>
          </div>
        </main>

        {previewOpen && canRunProject && (
          <PreviewPanel
            api={api}
            base={base}
            projectId={id}
            project={project}
            say={say}
            refreshKey={previewKey}
            onClose={() => setPreviewOpen(false)}
          />
        )}

        {historyOpen && (
          <VersionPanel
            api={api}
            base={base}
            projectId={id}
            projectName={project?.name || "project"}
            say={say}
            onClose={() => setHistoryOpen(false)}
            onRestored={reloadAfterRestore}
          />
        )}
      </div>
    </div>
  );
}
