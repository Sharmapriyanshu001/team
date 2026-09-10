import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  ChevronsRight,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";

import DataTable from "../components/DataTable";
import Toolbar from "../components/Toolbar";
import Modal, { ConfirmDialog } from "../components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  SelectOrOther,
  Textarea,
} from "../components/ui";
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  HIRE_AS_ROLES,
  INTERVIEW_OUTCOMES,
  NEXT_STAGE,
  shortDate,
  sourceLabel,
  stageLabel,
} from "./constants";

/**
 * The hiring pipeline.
 *
 * Hiring is a route of its own, not a stage the edit form can set: it creates
 * the person's staff account and hands back the login to pass on. The server
 * refuses "hired" on a plain update for exactly that reason, so the edit form
 * leaves that option out rather than offering one that will be refused.
 */

const BLANK = {
  name: "",
  email: "",
  phone: "",
  address: "",
  position: "",
  department: "",
  experience: "",
  skills: "",
  source: "other",
  sourceDetail: "",
  stage: "applied",
  expectedSalary: 0,
  hireAs: "employee",
  owner: "",
  jobOpening: "",
  notes: "",
};

/** Stages the edit form may set. "hired" belongs to the hire route alone. */
const EDITABLE_STAGES = CANDIDATE_STAGES.filter((stage) => stage.value !== "hired");

/**
 * `openingOptions` and `stagePath` are what the HR panel's Hiring section adds
 * on top of the plain candidate list the admin panel shows.
 *
 * Both default to off, so the admin's Recruitment screen renders exactly as it
 * did before Hiring existed — there is no job-opening field and no stage
 * buttons there, because the admin panel has no vacancy records behind it.
 */
/**
 * The usual answers, not the only ones.
 *
 * Every one of these fields is a SelectOrOther, so a department or a job title
 * nobody listed is typed in and stored exactly like a listed one. The list is
 * here to stop three spellings of "Operations" rather than to limit what the
 * company is allowed to have.
 */
const DEPARTMENTS = [
  "Execution",
  "Design",
  "Operations",
  "Sales",
  "Human Resources",
  "Accounts",
  "Marketing",
  "Admin",
];
const POSITIONS = [
  "Site Engineer",
  "Civil Engineer",
  "Architect",
  "Interior Designer",
  "Project Lead",
  "Developer",
  "UI/UX Designer",
  "Sales Executive",
  "HR Executive",
  "Accountant",
];

export default function RecruitmentPage({
  api,
  basePath,
  can,
  staffOptions = [],
  canHireDepartmentRoles = false,
  openingOptions = [],
  stagePath = "",
  title,
  subtitle,
}) {

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Scheduling a round
  const [scheduling, setScheduling] = useState(null);
  const [round, setRound] = useState({
    round: "",
    scheduledAt: "",
    mode: "online",
    interviewer: "",
    outcome: "scheduled",
    feedback: "",
  });

  // Hiring
  const [hiring, setHiring] = useState(null);
  const [hireForm, setHireForm] = useState({
    role: "employee",
    designation: "",
    department: "",
    address: "",
    password: "",
  });
  /**
   * The CV, held apart from the rest of the form because it is a File and not
   * a string — it decides whether the hire goes over multipart or as plain
   * JSON, which is the only thing about this request that changes.
   */
  const [resume, setResume] = useState(null);
  const [hired, setHired] = useState(null);

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .get(`${basePath}/candidates`, {
        params: {
          page,
          search: search || undefined,
          stage: stage || undefined,
          source: source || undefined,
        },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load candidates"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, basePath, page, search, stage, source, reloadKey]);

  const openAdd = () => {
    setEditing("new");
    setForm(BLANK);
    setFormError("");
  };

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      position: row.position || "",
      department: row.department || "",
      experience: row.experience || "",
      skills: (row.skills || []).join(", "),
      source: row.source || "other",
      sourceDetail: row.sourceDetail || "",
      stage: row.stage || "applied",
      expectedSalary: row.expectedSalary ?? 0,
      hireAs: row.hireAs || "employee",
      owner: row.owner?._id || "",
      jobOpening: row.jobOpening?._id || row.jobOpening || "",
      notes: row.notes || "",
    });
    setFormError("");
  };

  /**
   * Moving somebody along the pipeline.
   *
   * Its own route rather than the edit form, because it is the change that
   * has to be recorded — and because the server refuses "hired" there, which
   * belongs to onboarding.
   */
  const moveStage = async (row, stage) => {
    setError("");
    try {
      await api.put(`${stagePath}/${row._id}/stage`, { stage });
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not move this candidate");
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (editing === "new") await api.post(`${basePath}/candidates`, form);
      else await api.put(`${basePath}/candidates/${editing}`, form);

      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this candidate");
    } finally {
      setSaving(false);
    }
  };

  const schedule = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await api.post(`${basePath}/candidates/${scheduling._id}/interviews`, round);
      setScheduling(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add that round");
    } finally {
      setSaving(false);
    }
  };

  const hire = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      /**
       * Multipart only when there is actually a file. A hire without a CV
       * goes over as the same JSON body it always did, which keeps every
       * caller that never knew about the CV box working untouched.
       */
      let body = hireForm;

      if (resume) {
        body = new FormData();
        Object.entries(hireForm).forEach(([key, value]) => body.append(key, value ?? ""));
        body.append("resume", resume);
      }

      const { data } = await api.post(`${basePath}/candidates/${hiring._id}/hire`, body);
      setHiring(null);
      setResume(null);
      // The plaintext password is shown once, here — it cannot be read back
      // afterwards, because what is stored is a one-way hash
      setHired(data);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not hire this candidate");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`${basePath}/candidates/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that candidate");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.email || row.phone || "—"}</p>
        </div>
      ),
    },
    {
      key: "position",
      header: "Role",
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.position || "—"}</p>
          <p className="text-xs text-slate-400">{row.department || "—"}</p>
        </div>
      ),
    },
    { key: "experience", header: "Experience", render: (row) => row.experience || "—" },
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <div>
          <p className="text-slate-700">{sourceLabel(row.source)}</p>
          {row.sourceDetail && <p className="text-xs text-slate-400">{row.sourceDetail}</p>}
        </div>
      ),
    },
    {
      key: "interviews",
      header: "Rounds",
      render: (row) =>
        row.interviews?.length ? (
          <span className="text-slate-700">{row.interviews.length}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "stage",
      header: "Stage",
      render: (row) => (
        <div>
          <Badge value={row.stage}>{stageLabel(row.stage)}</Badge>
          {row.hiredAt && <p className="mt-1 text-[11px] text-slate-400">{shortDate(row.hiredAt)}</p>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {/* Shortlisting is the decision the candidate list exists to make.
              Only where a stage route was given — the admin panel has none. */}
          {stagePath && can("hiring", "edit") && !row.hiredUser && NEXT_STAGE[row.stage] && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveStage(row, NEXT_STAGE[row.stage]);
              }}
              title={`Move to ${stageLabel(NEXT_STAGE[row.stage])}`}
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            >
              <ChevronsRight size={15} />
            </button>
          )}
          {stagePath && can("hiring", "edit") && !row.hiredUser && row.stage !== "rejected" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveStage(row, "rejected");
              }}
              title="Not taking forward"
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <UserX size={15} />
            </button>
          )}
          {can("recruitment", "edit") && !row.hiredUser && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setScheduling(row);
                setRound({
                  round: "",
                  scheduledAt: "",
                  mode: "online",
                  interviewer: "",
                  outcome: "scheduled",
                  feedback: "",
                });
                setFormError("");
              }}
              title="Schedule a round"
              className="rounded-md p-1.5 text-slate-400 hover:bg-violet-50 hover:text-violet-600"
            >
              <CalendarPlus size={15} />
            </button>
          )}
          {can("recruitment", "create") && !row.hiredUser && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setHiring(row);
                setResume(null);
                setHireForm({
                  address: row.address || "",
                  role: row.hireAs || "employee",
                  designation: row.position || "",
                  department: row.department || "",
                  password: "",
                });
                setFormError("");
              }}
              title="Hire — creates their account"
              className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
            >
              <UserCheck size={15} />
            </button>
          )}
          {can("recruitment", "edit") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row);
              }}
              title="Edit"
              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            >
              <Pencil size={15} />
            </button>
          )}
          {can("recruitment", "delete") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTarget(row);
              }}
              title="Delete"
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  /**
   * Hiring into a department role creates a department login, which only a
   * full administrator may do — the server refuses it otherwise. So the option
   * is left out rather than offered and then refused.
   */
  const hireRoleOptions = canHireDepartmentRoles
    ? HIRE_AS_ROLES
    : HIRE_AS_ROLES.filter((role) => !role.label.includes("department account"));

  return (
    <div>
      <PageHeader title={title || "Recruitment"} subtitle={subtitle || `${total} candidates on record`}>
        {can("recruitment", "create") && (
          <Button onClick={openAdd}>
            <Plus size={15} />
            Add Candidate
          </Button>
        )}
      </PageHeader>

      <Alert>{error}</Alert>

      <Card>
        <Toolbar
          search={search}
          onSearch={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Search by name, email, position or skill"
          onFilter={(key, value) => {
            setPage(1);
            if (key === "stage") setStage(value);
            if (key === "source") setSource(value);
          }}
          filters={[
            { key: "stage", value: stage, placeholder: "All stages", options: CANDIDATE_STAGES },
            { key: "source", value: source, placeholder: "All sources", options: CANDIDATE_SOURCES },
          ]}
        />

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          page={page}
          pages={pages}
          total={total}
          onPageChange={setPage}
          onRowClick={can("recruitment", "edit") ? openEdit : undefined}
          emptyTitle="No candidates yet"
          emptyMessage="Add one to start the pipeline."
        />
      </Card>

      {/* ------------------------------------------------------ add / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a candidate" : "Edit candidate"}
        subtitle="Hiring is done from the list — it creates their account and shows the login"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <Alert>{formError}</Alert>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Email" hint="Becomes their login if they are hired">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" hint="Becomes the password unless one is typed in">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Position">
              <SelectOrOther
                options={POSITIONS}
                placeholder="Select the role being hired for"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </Field>
          </div>

          {/**
            * Asked here as well as at the hire, because somebody who has it at
            * the interview should not be asked again on their first morning —
            * the hire form reads it straight across.
            */}
          <Field label="Address">
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="House, street, city, state, PIN"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Department">
              <SelectOrOther
                options={DEPARTMENTS}
                placeholder="Select department"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="Experience">
              <Input
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                placeholder="2 years"
              />
            </Field>
            <Field label="Expected salary">
              <Input
                type="number"
                min="0"
                value={form.expectedSalary}
                onChange={(e) => setForm({ ...form, expectedSalary: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Skills" hint="Comma separated">
            <Input
              value={form.skills}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
              placeholder="React, Node, MongoDB"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Source">
              <Select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                options={CANDIDATE_SOURCES}
              />
            </Field>
            <Field label="Source detail">
              <Input
                value={form.sourceDetail}
                onChange={(e) => setForm({ ...form, sourceDetail: e.target.value })}
                placeholder="Which agency, who referred"
              />
            </Field>
            <Field label="Stage">
              <Select
                value={form.stage === "hired" ? "offer" : form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value })}
                options={EDITABLE_STAGES}
                disabled={form.stage === "hired"}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hire as" hint="What their account is created as">
              <Select
                value={form.hireAs}
                onChange={(e) => setForm({ ...form, hireAs: e.target.value })}
                options={hireRoleOptions}
              />
            </Field>
            <Field label="Owner" hint="Who on HR is carrying this one">
              <Select
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                options={staffOptions}
                placeholder="Nobody yet"
              />
            </Field>
          </div>

          {/* Only where there are vacancies to attach to — the admin panel has
              no job openings behind it, so the field is not offered there */}
          {openingOptions.length > 0 && (
            <Field
              label="Job opening"
              hint="The vacancy this application is against — the board measures the pipeline by it"
            >
              <Select
                value={form.jobOpening}
                onChange={(e) => setForm({ ...form, jobOpening: e.target.value })}
                options={openingOptions}
                placeholder="Not against an opening"
              />
            </Field>
          )}

          <Field label="Notes">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </form>
      </Modal>

      {/* --------------------------------------------------- schedule round */}
      <Modal
        open={Boolean(scheduling)}
        onClose={() => setScheduling(null)}
        title="Schedule a round"
        subtitle={scheduling ? `${scheduling.name}${scheduling.position ? ` · ${scheduling.position}` : ""}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setScheduling(null)}>
              Cancel
            </Button>
            <Button onClick={schedule} loading={saving}>
              Add Round
            </Button>
          </>
        }
      >
        <form onSubmit={schedule} className="space-y-3">
          <Alert>{formError}</Alert>

          {scheduling?.interviews?.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Rounds so far
              </p>
              <ul className="space-y-1.5">
                {scheduling.interviews.map((entry) => (
                  <li key={entry._id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700">
                      {entry.round}
                      {entry.interviewerName ? ` · ${entry.interviewerName}` : ""}
                    </span>
                    <span className="flex items-center gap-2 text-slate-400">
                      {shortDate(entry.scheduledAt)}
                      <Badge value={entry.outcome} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Round" required>
              <Input
                value={round.round}
                onChange={(e) => setRound({ ...round, round: e.target.value })}
                placeholder="Technical"
                required
              />
            </Field>
            <Field label="When">
              <Input
                type="datetime-local"
                value={round.scheduledAt}
                onChange={(e) => setRound({ ...round, scheduledAt: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode">
              <Select
                value={round.mode}
                onChange={(e) => setRound({ ...round, mode: e.target.value })}
                options={[
                  { value: "online", label: "Online" },
                  { value: "in_person", label: "In person" },
                  { value: "phone", label: "Phone" },
                ]}
              />
            </Field>
            <Field label="Interviewer" hint="They are told they have a round to take">
              <Select
                value={round.interviewer}
                onChange={(e) => setRound({ ...round, interviewer: e.target.value })}
                options={staffOptions}
                placeholder="Not decided"
              />
            </Field>
          </div>

          <Field label="Outcome">
            <Select
              value={round.outcome}
              onChange={(e) => setRound({ ...round, outcome: e.target.value })}
              options={INTERVIEW_OUTCOMES}
            />
          </Field>

          <Field label="Feedback">
            <Textarea
              rows={2}
              value={round.feedback}
              onChange={(e) => setRound({ ...round, feedback: e.target.value })}
              placeholder="Filled in after the round"
            />
          </Field>
        </form>
      </Modal>

      {/* --------------------------------------------------------- hiring */}
      <Modal
        open={Boolean(hiring)}
        onClose={() => setHiring(null)}
        title="Hire this candidate"
        subtitle={
          hiring
            ? `${hiring.name} — this creates their staff account and their login`
            : ""
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setHiring(null)}>
              Cancel
            </Button>
            <Button onClick={hire} loading={saving}>
              Hire
            </Button>
          </>
        }
      >
        <form onSubmit={hire} className="space-y-3">
          <Alert>{formError}</Alert>

          <Alert tone="success">
            Their login will be <strong>{hiring?.email || "their email"}</strong>. The candidate is
            kept and linked to the new account, so where the hire came from stays on record.
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hire as" required>
              <Select
                value={hireForm.role}
                onChange={(e) => setHireForm({ ...hireForm, role: e.target.value })}
                options={hireRoleOptions}
              />
            </Field>
            <Field label="Designation">
              <Input
                value={hireForm.designation}
                onChange={(e) => setHireForm({ ...hireForm, designation: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department">
              <SelectOrOther
                options={DEPARTMENTS}
                placeholder="Select department"
                value={hireForm.department}
                onChange={(e) => setHireForm({ ...hireForm, department: e.target.value })}
              />
            </Field>
            <Field
              label="Password"
              hint={`Leave blank to use their mobile number${hiring?.phone ? ` (${hiring.phone})` : ""}`}
            >
              <Input
                value={hireForm.password}
                onChange={(e) => setHireForm({ ...hireForm, password: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </div>

          <Field label="Address" hint="Where they live — goes onto their staff record">
            <Textarea
              rows={2}
              value={hireForm.address}
              onChange={(e) => setHireForm({ ...hireForm, address: e.target.value })}
              placeholder="House, street, city, state, PIN"
            />
          </Field>

          {/**
            * The CV, as a file rather than the link the application carried.
            * A link is to somebody else's Drive and stops working the week
            * they tidy it up; this is filed with their identity papers and is
            * still there in three years.
            */}
          <Field label="CV / Resume" hint="PDF or a photo, up to 8 MB — optional">
            {resume ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <FileText size={15} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {resume.name}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {Math.max(1, Math.round(resume.size / 1024))} KB
                </span>
                <button
                  type="button"
                  onClick={() => setResume(null)}
                  className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Remove the CV"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700">
                <Paperclip size={15} />
                Choose a file
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => setResume(e.target.files?.[0] || null)}
                />
              </label>
            )}
          </Field>
        </form>
      </Modal>

      {/* ------------------------------------------------- the new login */}
      <Modal
        open={Boolean(hired)}
        onClose={() => setHired(null)}
        title="Account created"
        subtitle="Pass these on now — the password cannot be read back afterwards"
        size="sm"
        footer={<Button onClick={() => setHired(null)}>Done</Button>}
      >
        <div className="space-y-3">
          <Alert tone="success">{hired?.message}</Alert>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Login ID
            </p>
            <p className="mb-3 font-mono text-sm text-slate-900">{hired?.credentials?.loginId}</p>

            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Password
            </p>
            <p className="font-mono text-sm text-slate-900">{hired?.credentials?.password}</p>
          </div>

          <p className="text-xs text-slate-500">
            Signed in as{" "}
            <span className="font-medium capitalize">
              {hired?.user?.role?.replace(/_/g, " ")}
            </span>
            . They can change this password from their own profile.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete candidate"
        message={`Delete "${target?.name}"? Their account, if they were hired, is not affected.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
