import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Link2, Save } from "lucide-react";

import { useRecordForm } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
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
  name: "",
  code: "",
  description: "",
  client: "",
  operationsManager: "",
  status: "planning",
  priority: "medium",
  progress: 0,
  budget: 0,
  startDate: "",
  endDate: "",

  /**
   * "Have we built this before?" — null until somebody answers, which is
   * not the same as no. Every project created before the question existed
   * answers null and is left saying nothing rather than claiming to be
   * fresh work.
   */
  existingWork: { builtBefore: null, link: "", note: "" },
};

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/**
 * ?client=<id> pre-selects the client.
 *
 * This is what "Create project" on a client's own page opens, so the project
 * lands linked to the client somebody was already looking at rather than
 * asking them to find the same name again in a dropdown of two hundred — which
 * is how a project ends up on the wrong client.
 */
const seedFromUrl = (params) => params.get("client") || "";

export default function CreateProject() {
  const navigate = useNavigate();
  const lookups = useLookups();
  const [params] = useSearchParams();

  const { form, change, setForm, submit, isEdit, loading, saving, error, success } = useRecordForm(
    "projects",
    EMPTY,
    (item) => ({
      ...item,
      client: item.client?._id || "",
      operationsManager: item.operationsManager?._id || "",
      startDate: toDateInput(item.startDate),
      endDate: toDateInput(item.endDate),
      existingWork: { ...EMPTY.existingWork, ...(item.existingWork || {}) },
    })
  );

  /**
   * Applied once, and never over an edit: opening an existing project with a
   * stray ?client= on the URL must not silently move it to another client.
   */
  const seeded = seedFromUrl(params);
  useEffect(() => {
    if (isEdit || !seeded) return;
    setForm((prev) => (prev.client ? prev : { ...prev, client: seeded }));
  }, [isEdit, seeded, setForm]);

  /**
   * A "yes" with nothing pasted after it is caught here as well as on the
   * server, because the field it is about is two inches away and the answer
   * is still in the person's head — a round trip to be told the same thing
   * helps nobody.
   */
  const [linkProblem, setLinkProblem] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (form.existingWork.builtBefore === true && !form.existingWork.link.trim()) {
      setLinkProblem("Paste the link to what was built before, or answer No");
      return;
    }
    setLinkProblem("");

    const payload = {
      ...form,
      progress: Number(form.progress) || 0,
      budget: Number(form.budget) || 0,
    };

    const ok = await submit(payload);
    if (ok && isEdit) setTimeout(() => navigate("/admin/projects"), 700);
  };

  /** One field inside the answer. */
  const changeWork = (key) => (value) =>
    setForm((prev) => ({ ...prev, existingWork: { ...prev.existingWork, [key]: value } }));

  const answer = (value) => {
    setLinkProblem("");
    setForm((prev) => ({
      ...prev,
      existingWork: {
        ...prev.existingWork,
        builtBefore: value,
        // Answering No puts the link away rather than keeping it under a
        // question that now says it does not exist. The server does the same.
        link: value ? prev.existingWork.link : "",
        note: value ? prev.existingWork.note : "",
      },
    }));
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title={isEdit ? "Edit Project" : "Create Project"}
        subtitle={isEdit ? "Update scope, timeline and ownership" : "Set up a new project and assign its leader"}
      >
        <Button variant="outline" onClick={() => navigate("/admin/projects")}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-4xl">
        <Card>
          <CardHeader title="Project details" subtitle="Fields marked * are required" />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Project name" required>
                <Input name="name" value={form.name} onChange={change} required placeholder="Green Valley Township" />
              </Field>

              <Field label="Project code">
                <Input name="code" value={form.code} onChange={change} placeholder="PRJ-001" />
              </Field>

              <Field label="Client">
                <Select
                  name="client"
                  value={form.client}
                  onChange={change}
                  placeholder="Select client"
                  options={lookups.clientOptions}
                />
              </Field>

              <Field label="Operations Manager">
                <Select
                  name="operationsManager"
                  value={form.operationsManager}
                  onChange={change}
                  placeholder="Select operations manager"
                  options={lookups.leaderOptions}
                />
              </Field>

              <Field label="Status">
                <Select
                  name="status"
                  value={form.status}
                  onChange={change}
                  options={["planning", "in_progress", "on_hold", "completed", "cancelled"]}
                />
              </Field>

              <Field label="Priority">
                <Select name="priority" value={form.priority} onChange={change} options={["low", "medium", "high"]} />
              </Field>

              <Field label="Start date">
                <Input name="startDate" type="date" value={form.startDate} onChange={change} />
              </Field>

              <Field label="End date">
                <Input name="endDate" type="date" value={form.endDate} onChange={change} />
              </Field>

              <Field label="Budget (₹)">
                <Input name="budget" type="number" min="0" value={form.budget} onChange={change} placeholder="2500000" />
              </Field>

              <Field label="Progress (%)">
                <Input
                  name="progress"
                  type="number"
                  min="0"
                  max="100"
                  value={form.progress}
                  onChange={change}
                />
              </Field>

              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  name="description"
                  value={form.description}
                  onChange={change}
                  rows={4}
                  placeholder="Scope of work, key deliverables and approvals needed."
                />
              </Field>
            </div>

            <ExistingWork
              value={form.existingWork}
              onAnswer={answer}
              onChange={changeWork}
              problem={linkProblem}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => navigate("/admin/projects")}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save size={15} />
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

/* ------------------------------------------- have we built this before? */

/**
 * The question asked at the bottom of every project as it is created.
 *
 * Half the work this company is asked for is work it has done before, and
 * the person who did it is not always the person being asked again. The
 * answer used to live in somebody's memory, or in a message nobody could
 * find two months later; here it sits on the project itself.
 *
 * Unanswered is a real state and looks like one — neither button pressed.
 * That matters because "nobody was asked" and "asked, and no" are different
 * things, and every project created before this existed is the first.
 *
 * The link is whatever the person has in their hand: the live site, the
 * repository, a folder of the last build, or another project on this panel.
 * A URL is the only thing those have in common, so a URL is what is asked
 * for — and the server stores it usable, adding the scheme to an address
 * pasted without one.
 */
function ExistingWork({ value, onAnswer, onChange, problem }) {
  const yes = value.builtBefore === true;
  const no = value.builtBefore === false;

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Have we built this project before?
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Same or close to something already delivered — say so, and link to it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Choice active={yes} onClick={() => onAnswer(true)}>
            Yes
          </Choice>
          <Choice active={no} onClick={() => onAnswer(false)}>
            No
          </Choice>
        </div>
      </div>

      {yes && (
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4">
          <Field
            label="Link to what was built"
            required
            hint={problem || "The live site, the repo, the earlier project — anything that opens it"}
          >
            <div className="relative">
              <Link2
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                value={value.link}
                onChange={(e) => onChange("link")(e.target.value)}
                placeholder="https://example.com/the-earlier-build"
                className="pl-9"
              />
            </div>
          </Field>

          <Field label="What was the same about it?" hint="Optional — a line is enough">
            <Input
              value={value.note}
              onChange={(e) => onChange("note")(e.target.value)}
              placeholder="Same layout, different branding"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** One of the two answers. Pressed shows as pressed, to a screen reader too. */
function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {active && <Check size={14} />}
      {children}
    </button>
  );
}
