import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileArchive, Save, Trash2, Upload } from "lucide-react";

import leaderApi from "../../leaderApi";
import { useRecordForm } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import { formatSize } from "../../../shared/format";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

const EMPTY = {
  title: "",
  description: "",
  project: "",
  team: "",
  assignedTo: "",
  status: "pending",
  priority: "medium",
  /**
   * When it should start, beside when it should end.
   *
   * A due date on its own says when somebody is late; it does not say when
   * they were meant to pick the job up. Two tasks due Friday, one of them a
   * week's work, read identically without this.
   */
  startDate: "",
  dueDate: "",
  /** How far along, as the person doing it reports it. */
  progress: 0,
  /** Money on this particular job, earned when the work is accepted. */
  bonus: "",
};

/**
 * What a task hangs off.
 *
 * A project, as it always has — or, for somebody who runs a department, the
 * department itself. Hiring, collections and proposals are real work with a
 * real owner and no client project, and before this there was nowhere to file
 * any of it.
 */
const BELONGS_TO = [
  { value: "project", label: "A project" },
  { value: "team", label: "My department" },
];

// What the uploader on the server accepts. Said here only so the form can
// refuse an over-sized file before spending a minute sending it.
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export default function CreateTask() {
  const navigate = useNavigate();
  const lookups = useLookups();

  /**
   * A ZIP travelling with the brief.
   *
   * "Carry on from where this got to" is an ordinary thing to ask, and there
   * was nowhere to put the thing being carried on from — the employee read
   * the description and had to go and ask for the files. Held apart from the
   * form because it does not travel with it: the task is created as ordinary
   * JSON first, then the archive is posted against the id that comes back.
   */
  const fileInput = useRef(null);
  const [zip, setZip] = useState(null);
  const [zipNote, setZipNote] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [zipError, setZipError] = useState("");

  const { id, form, change, setForm, submit, isEdit, loading, saving, error, success } = useRecordForm(
    "tasks",
    EMPTY,
    (item) => ({
      ...item,
      project: item.project?._id || "",
      team: item.team?._id || "",
      assignedTo: item.assignedTo?._id || "",
      startDate: item.startDate ? new Date(item.startDate).toISOString().slice(0, 10) : "",
      dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : "",
      progress: item.progress ?? 0,
      // Blank rather than 0, so an untouched box does not read as "no bonus"
      bonus: item.bonus ? String(item.bonus) : "",
    })
  );

  // An existing task shows the kind it already is; a new one starts on a
  // project, which is what nearly all of them are.
  const belongsTo = form.team && !form.project ? "team" : "project";

  // What is already attached, so an edit can show it rather than silently
  // adding a second copy of the same archive
  useEffect(() => {
    if (!isEdit) return undefined;
    let active = true;

    leaderApi
      .get(`/leader/tasks/${id}`)
      .then(({ data }) => active && setAttachments(data.attachments || []))
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isEdit, id]);

  const pickZip = (e) => {
    const chosen = e.target.files?.[0] || null;
    setZipError("");

    if (chosen && chosen.size > MAX_ZIP_BYTES) {
      setZipError(`That file is ${formatSize(chosen.size)} — the limit is 50 MB`);
      e.target.value = "";
      return;
    }
    setZip(chosen);
  };

  const clearZip = () => {
    setZip(null);
    setZipError("");
    if (fileInput.current) fileInput.current.value = "";
  };

  /** Posts the chosen archive against a task that now exists. */
  const uploadZip = async (taskId) => {
    const body = new FormData();
    body.append("file", zip);
    if (zipNote.trim()) body.append("note", zipNote.trim());

    const { data } = await leaderApi.post(`/leader/tasks/${taskId}/attachment`, body);
    return data.item;
  };

  const detach = async (file) => {
    try {
      await leaderApi.delete(`/leader/tasks/${id}/attachment/${file._id}`);
      setAttachments((prev) => prev.filter((row) => row._id !== file._id));
    } catch (err) {
      setZipError(err.response?.data?.message || "Could not remove that file");
    }
  };

  const changeBelongsTo = (e) =>
    setForm((current) => ({
      ...current,
      ...(e.target.value === "team" ? { project: "" } : { team: "" }),
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = { ...form };
    if (!payload.assignedTo) delete payload.assignedTo;
    if (!payload.dueDate) delete payload.dueDate;
    if (!payload.startDate) delete payload.startDate;

    /**
     * An empty bonus box means "no bonus", which is zero — sent explicitly so
     * clearing one actually clears it, rather than the field being dropped and
     * the old amount surviving the edit.
     */
    payload.bonus = Number(payload.bonus) || 0;
    payload.progress = Number(payload.progress) || 0;
    // Only one of the two travels, so an edit that moves a task between them
    // clears the side it left rather than keeping both links
    if (belongsTo === "team") payload.project = null;
    else payload.team = null;

    const saved = await submit(payload);
    if (!saved) return;

    /**
     * The archive goes up after the task exists, because it has to be
     * attached to something. A failed upload is reported on its own rather
     * than rolled into the task's error: the task itself did save, and
     * telling the manager otherwise would have them create it twice.
     */
    if (zip) {
      const taskId = saved._id || id;
      setUploading(true);
      setZipError("");

      try {
        const file = await uploadZip(taskId);
        setAttachments((prev) => [file, ...prev]);
        clearZip();
        setZipNote("");
      } catch (err) {
        setZipError(
          err.response?.data?.message || "The task was saved, but the file could not be attached"
        );
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    if (isEdit) setTimeout(() => navigate("/operation-manager/tasks/assigned"), 700);
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Task" : "Create Task"}
        subtitle={
          lookups.managesDepartment
            ? "Assign work against one of your projects, or to your department"
            : "Assign work to your team against one of your projects"
        }
      >
        <Button variant="outline" onClick={() => navigate("/operation-manager/tasks/assigned")}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <Card>
          <CardHeader title="Task details" subtitle="Fields marked * are required" />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Title" required className="sm:col-span-2">
                <Input
                  name="title"
                  value={form.title}
                  onChange={change}
                  required
                  placeholder="Prepare structural drawings"
                />
              </Field>

              {lookups.managesDepartment && (
                <Field label="This work is for" className="sm:col-span-2">
                  <Select value={belongsTo} onChange={changeBelongsTo} options={BELONGS_TO} />
                </Field>
              )}

              {belongsTo === "team" ? (
                <Field label="Department" required>
                  <Select
                    name="team"
                    value={form.team}
                    onChange={change}
                    required
                    placeholder="Select a department you run"
                    options={lookups.departmentOptions}
                  />
                </Field>
              ) : (
                <Field label="Project" required>
                  <Select
                    name="project"
                    value={form.project}
                    onChange={change}
                    required
                    placeholder="Select one of your projects"
                    options={lookups.projectOptions}
                  />
                </Field>
              )}

              <Field label="Assign to" hint="Any active employee — your own people first">
                <Select
                  name="assignedTo"
                  value={form.assignedTo}
                  onChange={change}
                  placeholder="Leave unassigned"
                  options={lookups.teamOptions}
                />
              </Field>

              <Field label="Priority">
                <Select
                  name="priority"
                  value={form.priority}
                  onChange={change}
                  options={["low", "medium", "high"]}
                />
              </Field>

              <Field label="Start date" hint="When they should pick it up">
                <Input name="startDate" type="date" value={form.startDate} onChange={change} />
              </Field>

              <Field label="Due date">
                <Input name="dueDate" type="date" value={form.dueDate} onChange={change} />
              </Field>

              <Field
                label="Bonus"
                hint="Earned when you approve the work. Blank means none."
              >
                <Input
                  name="bonus"
                  type="number"
                  min={0}
                  step={100}
                  value={form.bonus}
                  onChange={change}
                  placeholder="0"
                />
              </Field>

              <Field
                label="Progress"
                hint="Usually left at 0 — the person doing it reports this"
              >
                <div className="flex items-center gap-3">
                  <input
                    name="progress"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={form.progress}
                    onChange={change}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
                  />
                  <span className="w-10 text-right text-sm font-medium text-slate-700">
                    {form.progress}%
                  </span>
                </div>
              </Field>

              <Field label="Status" className="sm:col-span-2">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={["pending", "in_progress", "review", "completed"]}
                />
              </Field>

              <Field
                label="Description"
                hint="The whole brief — what needs doing, what it depends on, and what done looks like"
                className="sm:col-span-2"
              >
                <Textarea
                  name="description"
                  value={form.description}
                  onChange={change}
                  rows={6}
                  placeholder="What exactly needs doing, and what does done look like?"
                />
              </Field>

              {/* ------------------------------------------------- the archive */}
              <div className="sm:col-span-2">
                <div className="rounded-lg border border-dashed border-slate-300 p-4">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-slate-400">
                      <FileArchive size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">Attach a ZIP</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Work already part-done, the assets, last week's export — whatever this
                        task starts from. Up to 50 MB, .zip only. They download it from the task.
                      </p>
                    </div>
                  </div>

                  <Alert>{zipError}</Alert>

                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {attachments.map((file) => (
                        <div
                          key={file._id}
                          className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"
                        >
                          <FileArchive size={14} className="shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-slate-700">
                              {file.title}
                            </p>
                            <p className="text-[11px] text-slate-400">{formatSize(file.size)}</p>
                          </div>
                          {isEdit && (
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => detach(file)}
                            >
                              <Trash2 size={13} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".zip"
                      onChange={pickZip}
                      className="block w-full text-xs text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50 sm:w-auto"
                    />
                    {zip && (
                      <>
                        <span className="text-xs text-slate-500">{formatSize(zip.size)}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={clearZip}>
                          Clear
                        </Button>
                      </>
                    )}
                  </div>

                  {zip && (
                    <Field label="Note with the file" className="mt-3">
                      <Input
                        value={zipNote}
                        onChange={(e) => setZipNote(e.target.value)}
                        placeholder="What is in it, and where to pick up from"
                      />
                    </Field>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => navigate("/operation-manager/tasks/assigned")}>
              Cancel
            </Button>
            <Button type="submit" loading={saving || uploading}>
              {uploading ? <Upload size={15} /> : <Save size={15} />}
              {uploading
                ? "Attaching file..."
                : isEdit
                  ? "Save changes"
                  : zip
                    ? "Create task & attach"
                    : "Create task"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
