import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileCode2,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  Pencil,
  Play,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";

import Modal, { ConfirmDialog } from "./Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loader,
  PageHeader,
  Textarea,
} from "./ui";

const STACK_TONES = {
  static: "sky",
  react: "blue",
  vite: "blue",
  next: "blue",
  node: "black",
  unknown: "slate",
};

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const formatSize = (bytes = 0) => {
  if (!bytes) return "—";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

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
 * "My Projects" — the code projects an admin assigned to the signed-in team
 * leader or employee. Identical in both panels, so each mounts it with its own
 * api instance and base path.
 *
 * The buttons this renders follow `myAccess`, which the server sends with each
 * row. That is a convenience for the person reading the screen, not the
 * control: every action re-checks the assignment server-side.
 *
 * Three deletes are within reach of this screen and they are not the same
 * thing, so it is worth being exact about which is which:
 *
 *   deleting a file        inside the workspace. Removes one wrong file and
 *                          leaves the project running.
 *
 *   "Delete Project"       below. Removes the project from this panel and
 *                          puts it in the admin's bin. Every file, every
 *                          saved version and the assignment are kept, and an
 *                          admin can put it back. There is no version of this
 *                          button, and no request this page can send, that
 *                          destroys anything.
 *
 *   permanent deletion     does not exist here at all. It lives on the admin
 *                          panel, behind adminAuth, and no token this screen
 *                          holds can reach it.
 *
 * Renaming a project and changing who is on it stay the admin's. "Request
 * admin" is how this panel asks for those: it writes a row into a queue and
 * changes nothing else.
 */
export default function MyCodeProjects({ api, base, workspaceBase, subtitle }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [treeFor, setTreeFor] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [success, setSuccess] = useState("");
  const [requestFor, setRequestFor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`${base}/code-projects`);
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load your projects");
    } finally {
      setLoading(false);
    }
  }, [api, base]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The project as it was uploaded. The admin card has always had this; the
   * assigned side did not, so the one person actually doing the work could not
   * take it to a local editor.
   */
  const downloadArchive = async (row) => {
    setBusyId(row._id);
    try {
      const { data } = await api.get(`${base}/code-projects/${row._id}/archive`, {
        responseType: "blob",
      });
      saveBlob(data, row.zipOriginalName || `${row.name}.zip`);
      setError("");
    } catch {
      setError("Could not download the original archive");
    } finally {
      setBusyId("");
    }
  };

  /**
   * Send the ask. The list is reloaded rather than patched in place, because
   * the server decides what a pending request looks like — and because the
   * same call is what would reveal that the project has been deleted out from
   * under this screen in the meantime.
   */
  const submitRequest = async (payload) => {
    if (!requestFor) return;

    setBusyId(requestFor._id);
    try {
      const { data } = await api.post(`${base}/code-projects/${requestFor._id}/requests`, payload);
      setSuccess(data.message || "Sent to the admin");
      setError("");
      setRequestFor(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not send that request");
      setRequestFor(null);
    } finally {
      setBusyId("");
    }
  };

  /** Taking back your own ask, while it is still unanswered. */
  const withdraw = async (row, request) => {
    setBusyId(row._id);
    try {
      const { data } = await api.delete(`${base}/code-projects/requests/${request._id}`);
      setSuccess(data.message || "Request withdrawn");
      setError("");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not withdraw that request");
    } finally {
      setBusyId("");
    }
  };

  /**
   * Deleting the project itself.
   *
   * Worth being clear about what this is not: it is not the file delete in the
   * workspace, and it does not destroy anything. The server flags the record
   * and the project moves to the admin's bin, where it keeps every file, every
   * saved version and its assignment until an admin decides. There is no call
   * this panel can make that would do more than that.
   */
  const deleteProject = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const { data } = await api.delete(`${base}/code-projects/${deleteTarget._id}`);
      setSuccess(data.message || "Project deleted");
      setError("");
      // It is out of scope for this account now, so drop the card rather than
      // reloading into a list it can no longer be in
      setItems((prev) => prev.filter((row) => row._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that project");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const needle = search.trim().toLowerCase();
  const rows = needle
    ? items.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.description || "").toLowerCase().includes(needle)
      )
    : items;

  return (
    <div>
      <PageHeader
        title="My Projects"
        subtitle={subtitle || "Code the admin has assigned to you — open it here, no download needed"}
      />

      <Alert>{error}</Alert>
      {success && <Alert tone="success">{success}</Alert>}

      {items.length > 3 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your projects"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
          />
        </div>
      )}

      {loading ? (
        <Card>
          <Loader label="Loading your projects…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title={items.length ? "Nothing matches that search" : "No projects assigned to you yet"}
            message={
              items.length
                ? "Try a different word."
                : "When an admin assigns you a code project, it appears here with its files."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const access = row.myAccess || {};
            const pending = row.myPendingRequests || [];

            return (
              <Card key={row._id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <FileCode2 size={18} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{row.name}</p>
                      <Badge tone={STACK_TONES[row.stack] || "slate"}>{row.stack}</Badge>
                      {row.status === "archived" && <Badge tone="slate">archived</Badge>}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {row.fileCount} files · {formatSize(row.totalSize)}
                    </p>
                    {/* Who handed this workspace over, and when — blank when it
                        came straight from an admin rather than an operations manager */}
                    {row.assignedBy && (
                      <p className="truncate text-xs text-slate-500">
                        Sent by {row.assignedBy}
                        {row.assignedAt ? ` · ${formatWhen(row.assignedAt)}` : ""}
                      </p>
                    )}
                    {row.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{row.description}</p>
                    )}
                  </div>
                </div>

                {/* what this person may do, straight from the server */}
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                  <Capability on={access.canEdit} icon={SquarePen} label="Edit code" />
                  <Capability on={access.canCreateDelete} icon={Pencil} label="Create & delete" />
                  <Capability on={access.canRun} icon={Play} label="Run & preview" />
                </div>

                {!row.workspaceReady && (
                  <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-snug text-red-800 ring-1 ring-inset ring-red-100">
                    This project was not extracted properly — ask your admin to upload it again.
                  </p>
                )}

                {pending.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {pending.map((request) => (
                      <div
                        key={request._id}
                        className="flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-100"
                      >
                        <Clock size={12} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {request.type === "delete" ? "Delete" : "Edit"} request waiting on the
                          admin
                        </span>
                        <button
                          type="button"
                          disabled={busyId === row._id}
                          onClick={() => withdraw(row, request)}
                          className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-950 disabled:opacity-50"
                        >
                          Withdraw
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
                  {/* Asks the admin. Changes nothing on its own. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mr-auto"
                    disabled={busyId === row._id}
                    onClick={() => setRequestFor(row)}
                  >
                    <MessageSquarePlus size={13} />
                    Request admin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!row.workspaceReady}
                    onClick={() => setTreeFor(row)}
                  >
                    <FolderOpen size={13} />
                    Browse files
                  </Button>
                  {/* Deliberately not disabled with the rest: when extraction
                      failed, the uploaded ZIP is the only copy of the code
                      still reachable, so that is exactly when it is needed. */}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === row._id}
                    onClick={() => downloadArchive(row)}
                  >
                    <Download size={13} />
                    Original ZIP
                  </Button>
                  <Button
                    size="sm"
                    disabled={!row.workspaceReady}
                    onClick={() => navigate(`${workspaceBase}/${row._id}/workspace`)}
                  >
                    <Eye size={13} />
                    Open Workspace
                  </Button>
                  {/* Deletes the whole project, not a file in it. Soft: it goes
                      to the admin's bin, and only an admin can empty that. */}
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === row._id}
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 size={13} />
                    Delete Project
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {treeFor && (
        <FileTreeModal api={api} base={base} project={treeFor} onClose={() => setTreeFor(null)} />
      )}

      {requestFor && (
        <RequestModal
          project={requestFor}
          loading={busyId === requestFor._id}
          onSubmit={submitRequest}
          onClose={() => setRequestFor(null)}
        />
      )}

      {/* The project, not a file in it — the wording has to make that
          unmistakable, because the two live a few pixels apart. */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this project"
        message={`Delete "${deleteTarget?.name}"? It disappears from your projects and goes to the admin's bin — the files, the saved versions and who is assigned are all kept, and an admin can restore it. To remove a single wrong file instead, open the workspace and delete it there.`}
        confirmLabel="Delete project"
        loading={deleting}
        onConfirm={deleteProject}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function Capability({ on, icon: Icon, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset ${
        on
          ? "bg-blue-50 text-blue-700 ring-blue-200"
          : "bg-slate-50 text-slate-400 ring-slate-200 line-through"
      }`}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- request */

/**
 * Asking the admin to rename a project or to remove it.
 *
 * Only the name and the description can be asked for. Who is assigned, who
 * leads it and what the project's permissions are stay off this form on
 * purpose: those are the settings that decide what everybody else may do, and
 * a request to change them would be a request to widen your own access.
 */
function RequestModal({ project, loading, onSubmit, onClose }) {
  const [type, setType] = useState("edit");
  const [name, setName] = useState(project.name || "");
  const [description, setDescription] = useState(project.description || "");
  const [reason, setReason] = useState("");

  const deleting = type === "delete";
  const nothingChanged =
    !deleting &&
    name.trim() === (project.name || "") &&
    description.trim() === (project.description || "");

  const send = () => {
    if (deleting) return onSubmit({ type: "delete", reason: reason.trim() });
    return onSubmit({
      type: "edit",
      reason: reason.trim(),
      name: name.trim(),
      description: description.trim(),
    });
  };

  return (
    <Modal
      open
      title="Ask the admin"
      subtitle={project.name}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} disabled={!reason.trim() || nothingChanged} onClick={send}>
            Send request
          </Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <TypeChoice
          active={!deleting}
          icon={Pencil}
          label="Change details"
          hint="Name or description"
          onClick={() => setType("edit")}
        />
        <TypeChoice
          active={deleting}
          icon={Trash2}
          label="Delete project"
          hint="Admin decides"
          onClick={() => setType("delete")}
        />
      </div>

      {deleting ? (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Nothing is deleted by sending this. The admin reviews it, and only they can remove the
          project — you will be told either way.
        </p>
      ) : (
        <>
          <Field label="Project name" className="mb-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" className="mb-3">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </>
      )}

      <Field
        label="Why"
        required
        hint="The admin sees this — say enough that they can decide without coming back to you."
      >
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            deleting ? "e.g. this was uploaded twice by mistake" : "e.g. the client renamed it"
          }
        />
      </Field>

      {nothingChanged && (
        <p className="mt-1.5 text-xs text-slate-500">
          Change the name or the description first — there is nothing to ask for yet.
        </p>
      )}
    </Modal>
  );
}

function TypeChoice({ active, icon: Icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset transition-colors ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon size={13} />
        {label}
      </span>
      <span className={`text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>{hint}</span>
    </button>
  );
}

/* ------------------------------------------------------------- file tree */

function TreeNode({ node, depth }) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === "file") {
    return (
      <div
        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <FileCode2 size={13} className="shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-slate-400">{formatSize(node.size)}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Folder size={13} className="shrink-0 text-blue-500" />
        <span className="truncate">{node.name}</span>
        {node.collapsed && <span className="text-[10px] text-slate-400">(not extracted)</span>}
      </button>

      {open && node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}

function FileTreeModal({ api, base, project, onClose }) {
  const [state, setState] = useState({ loading: true, tree: [], truncated: false, error: "" });

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/code-projects/${project._id}/tree`)
      .then(({ data }) => {
        if (!active) return;
        setState({ loading: false, tree: data.tree || [], truncated: data.truncated, error: "" });
      })
      .catch((err) => {
        if (!active) return;
        setState({
          loading: false,
          tree: [],
          truncated: false,
          error: err.response?.data?.message || "Could not read the file tree",
        });
      });

    return () => {
      active = false;
    };
  }, [api, base, project._id]);

  return (
    <Modal
      open
      title={project.name}
      subtitle={`${project.fileCount} files · ${project.stack}`}
      onClose={onClose}
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Alert>{state.error}</Alert>

      {state.loading ? (
        <Loader label="Reading the project…" />
      ) : (
        <>
          {state.truncated && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
              This project is very large — the tree below is capped.
            </p>
          )}
          <div className="max-h-[26rem] overflow-auto rounded-lg border border-slate-200 py-1">
            {state.tree.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Read-only for now. Opening files, editing and preview arrive with the workspace.
          </p>
        </>
      )}
    </Modal>
  );
}
