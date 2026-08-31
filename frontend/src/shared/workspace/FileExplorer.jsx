import { useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Text,
  Trash2,
} from "lucide-react";

/** A rough icon per extension — enough to scan a tree quickly. */
const iconFor = (name) => {
  const ext = name.toLowerCase().split(".").pop();
  if (["json"].includes(ext)) return FileJson;
  if (["md", "txt", "log"].includes(ext)) return FileText;
  if (["js", "jsx", "ts", "tsx", "html", "css", "scss", "py", "java", "php", "go", "rs", "sql", "sh", "yml", "yaml", "xml"].includes(ext)) {
    return FileCode2;
  }
  return File;
};

/** Every file path in the tree, flattened, for the name filter. */
const flatten = (nodes, out = []) => {
  for (const node of nodes) {
    if (node.type === "file") out.push(node);
    else if (node.children?.length) flatten(node.children, out);
  }
  return out;
};

/* -------------------------------------------------------------- tree node */

function Node({ node, depth, activePath, onOpen, dirtyPaths, actions, selectedFolder, onSelectFolder }) {
  const [open, setOpen] = useState(depth < 1);

  const rowActions = actions && (
    <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
      <button
        onClick={(e) => {
          e.stopPropagation();
          actions.onRename(node);
        }}
        title="Rename"
        className="rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"
      >
        <Pencil size={11} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          actions.onDelete(node);
        }}
        title="Delete"
        className="rounded p-0.5 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
      >
        <Trash2 size={11} />
      </button>
    </span>
  );

  if (node.type === "file") {
    const Icon = iconFor(node.name);
    const active = node.path === activePath;
    const dirty = dirtyPaths.has(node.path);

    return (
      <div
        className={`group flex items-center gap-1.5 py-[3px] pr-1.5 text-[13px] transition-colors ${
          active ? "bg-blue-600/20 text-white" : "text-slate-300 hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <button
          onClick={() => onOpen(node)}
          title={node.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-white"
        >
          <Icon size={13} className="shrink-0 text-slate-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
        {rowActions}
      </div>
    );
  }

  const empty = !node.children?.length;
  const selected = selectedFolder === node.path;

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-[3px] pr-1.5 text-[13px] transition-colors ${
          selected ? "bg-white/10 text-white" : "text-slate-200 hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          onClick={() => {
            setOpen(!open);
            onSelectFolder?.(selected ? "" : node.path);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={`${node.path} — click to make this the target for new files`}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""} ${
              empty ? "opacity-30" : ""
            }`}
          />
          {open && !empty ? (
            <FolderOpen size={13} className="shrink-0 text-blue-400" />
          ) : (
            <Folder size={13} className="shrink-0 text-blue-400" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {node.collapsed && <span className="text-[10px] text-slate-600">skipped</span>}
        {rowActions}
      </div>

      {open &&
        node.children?.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            onOpen={onOpen}
            dirtyPaths={dirtyPaths}
            actions={actions}
            selectedFolder={selectedFolder}
            onSelectFolder={onSelectFolder}
          />
        ))}
    </div>
  );
}

/* -------------------------------------------------------------- explorer */

/**
 * The left rail of the workspace. Dark, because it sits beside a dark editor
 * and a light panel there would fight the code for attention.
 *
 * Create, rename and delete only appear when the server said this account has
 * canCreateDelete. Hiding them is courtesy; every one of those calls is
 * checked again server-side.
 */
export default function FileExplorer({
  tree,
  activePath,
  onOpen,
  dirtyPaths = new Set(),
  truncated,
  canCreateDelete = false,
  onCreate,
  onRename,
  onDelete,
  onSearch,
  searchResults,
  searching,
}) {
  const [mode, setMode] = useState("names");
  const [query, setQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");

  const files = useMemo(() => flatten(tree), [tree]);
  const needle = query.trim().toLowerCase();

  const nameMatches =
    mode === "names" && needle
      ? files.filter((f) => f.path.toLowerCase().includes(needle)).slice(0, 200)
      : [];

  const actions = canCreateDelete ? { onRename, onDelete } : null;

  const submitSearch = (e) => {
    e.preventDefault();
    if (mode === "contents") onSearch?.(query.trim());
  };

  return (
    <div className="flex h-full flex-col bg-[#0B0F1A]">
      {/* create actions */}
      {canCreateDelete && (
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
          <span className="mr-auto truncate text-[11px] text-slate-500">
            {selectedFolder ? `into ${selectedFolder}/` : "into the project root"}
          </span>
          <button
            onClick={() => onCreate?.("file", selectedFolder)}
            title="New file"
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <FilePlus2 size={13} />
          </button>
          <button
            onClick={() => onCreate?.("folder", selectedFolder)}
            title="New folder"
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <FolderPlus size={13} />
          </button>
        </div>
      )}

      {/* search */}
      <form onSubmit={submitSearch} className="shrink-0 border-b border-white/10 p-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "names" ? "Search file names" : "Search in files, then Enter"}
            className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-7 pr-8 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setMode(mode === "names" ? "contents" : "names")}
            title={mode === "names" ? "Switch to searching inside files" : "Switch to searching names"}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 transition-colors ${
              mode === "contents"
                ? "bg-blue-600/30 text-blue-300"
                : "text-slate-500 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Text size={12} />
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {/* ------------------------------------------- searching in files */}
        {mode === "contents" ? (
          searching ? (
            <p className="px-3 py-4 text-xs text-slate-500">Searching…</p>
          ) : !searchResults ? (
            <p className="px-3 py-4 text-xs text-slate-500">
              Type at least two characters and press Enter.
            </p>
          ) : !searchResults.results.length ? (
            <p className="px-3 py-4 text-xs text-slate-500">
              Nothing matches “{searchResults.query}”.
            </p>
          ) : (
            <>
              <p className="px-3 py-1.5 text-[11px] text-slate-500">
                {searchResults.results.length} match
                {searchResults.results.length === 1 ? "" : "es"} in {searchResults.files} file
                {searchResults.files === 1 ? "" : "s"}
                {searchResults.truncated && " (capped)"}
              </p>
              {searchResults.results.map((hit, i) => (
                <button
                  key={`${hit.path}:${hit.line}:${i}`}
                  onClick={() => onOpen({ path: hit.path, name: hit.name }, hit.line)}
                  className="block w-full px-3 py-1 text-left hover:bg-white/5"
                >
                  <span className="block truncate text-[12px] text-slate-300">
                    {hit.path}
                    <span className="text-slate-600">:{hit.line}</span>
                  </span>
                  <span className="block truncate font-mono text-[11px] text-slate-500">
                    {hit.text}
                  </span>
                </button>
              ))}
            </>
          )
        ) : /* -------------------------------------------- filtering names */
        needle ? (
          nameMatches.length ? (
            nameMatches.map((node) => {
              const Icon = iconFor(node.name);
              return (
                <button
                  key={node.path}
                  onClick={() => onOpen(node)}
                  title={node.path}
                  className={`flex w-full items-center gap-1.5 px-3 py-[3px] text-left text-[13px] transition-colors ${
                    node.path === activePath
                      ? "bg-blue-600/20 text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon size={13} className="shrink-0 text-slate-500" />
                  <span className="truncate">{node.path}</span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-4 text-xs text-slate-500">No file name matches that.</p>
          )
        ) : (
          tree.map((node) => (
            <Node
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onOpen={onOpen}
              dirtyPaths={dirtyPaths}
              actions={actions}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
            />
          ))
        )}
      </div>

      {truncated && (
        <p className="shrink-0 border-t border-white/10 px-3 py-2 text-[11px] text-amber-400/80">
          Very large project — the tree is capped.
        </p>
      )}
    </div>
  );
}
