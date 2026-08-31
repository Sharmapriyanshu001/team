import { useState } from "react";
import { Plus, FileCode, Eye, GitBranch } from "lucide-react";

import employeeApi from "../employeeApi";
import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import DataTable from "../../shared/components/DataTable";
import Toolbar from "../../shared/components/Toolbar";
import Modal from "../../shared/components/Modal";
import CodeViewer from "../../shared/components/CodeViewer";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "php",
  "html",
  "css",
  "sql",
  "json",
  "other",
];

const STATUSES = ["pending", "approved", "changes_required", "rejected"];

const EMPTY = {
  title: "",
  description: "",
  language: "javascript",
  project: "",
  task: "",
  code: "",
  repoUrl: "",
  note: "",
};

/**
 * "My Code" — the employee submits code for review and follows what happened
 * to it. Editing is by new version, never in place, so the history survives.
 *
 * Review is the team leader's: a submission is routed to whoever leads the
 * project, or failing that to whoever the employee reports to, and only falls
 * to the admin when there is no such person. "Changes required" is that leader
 * sending it back — the answer is a new version on the same submission, which
 * is what the branch button does.
 */
export default function MyCode() {
  const crud = useCrud("code");
  const lookups = useLookups();

  // null | "new" | record (record = adding a version to that submission)
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [viewing, setViewing] = useState(null);

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const openNew = () => {
    setForm(EMPTY);
    setFormError("");
    setEditing("new");
  };

  const openVersion = (row) => {
    setForm({ ...EMPTY, language: row.language, title: row.title });
    setFormError("");
    setEditing(row);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (editing === "new") {
        await employeeApi.post("/employee/code", form);
      } else {
        await employeeApi.post(`/employee/code/${editing._id}/versions`, {
          code: form.code,
          repoUrl: form.repoUrl,
          note: form.note,
        });
      }
      crud.refresh();
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send the code");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Submission",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileCode size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{row.title}</p>
            <p className="text-xs text-slate-400">
              {row.language} · {row.versionCount} version{row.versionCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      ),
    },
    { key: "project", header: "Project", render: (row) => row.project?.name || "—" },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "approvedVersion",
      header: "Approved",
      render: (row) => (row.approvedVersion ? `v${row.approvedVersion}` : "—"),
    },
    {
      key: "shareCount",
      header: "Shared with",
      render: (row) => (row.shareCount ? `${row.shareCount} people` : "—"),
    },
    {
      key: "reviewer",
      header: "With",
      render: (row) => (
        <span className="text-xs text-slate-500">{row.reviewer?.name || "Admin"}</span>
      ),
    },
    {
      key: "reviewNote",
      header: "Review comment",
      render: (row) => (
        <span className="text-xs text-slate-500">{row.reviewNote || "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setViewing(row._id)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            title="Open code"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={() => openVersion(row)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            title="Add a new version"
          >
            <GitBranch size={15} />
          </button>
        </div>
      ),
    },
  ];

  const isNew = editing === "new";

  return (
    <div>
      <PageHeader title="My Code" subtitle="Code you sent for review, and what came back">
        <Button onClick={openNew}>
          <Plus size={15} />
          Submit Code
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search your submissions"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: STATUSES.map((s) => ({ value: s, label: s })),
            },
            {
              key: "project",
              value: crud.filters.project,
              placeholder: "All projects",
              options: lookups.projectOptions,
            },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          emptyTitle="No code submitted yet"
          emptyMessage="Send your work to the admin — they review it and decide who else can see it."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        size="lg"
        title={isNew ? "Submit code for review" : `New version of "${editing?.title}"`}
        subtitle={
          isNew
            ? "Your team leader reviews it before anyone else can see it"
            : "The new version goes back to your team leader for review"
        }
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              {isNew ? "Send for review" : "Add version"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Alert>{formError}</Alert>

          {isNew && (
            <>
              <Field label="Title" required className="sm:col-span-2">
                <Input
                  name="title"
                  value={form.title}
                  onChange={change}
                  required
                  placeholder="Attendance export script"
                />
              </Field>

              <Field label="What does it do?" className="sm:col-span-2">
                <Textarea
                  name="description"
                  value={form.description}
                  onChange={change}
                  placeholder="A short description for the admin"
                />
              </Field>

              <Field label="Language">
                <Select
                  name="language"
                  value={form.language}
                  onChange={change}
                  options={LANGUAGES.map((l) => ({ value: l, label: l }))}
                />
              </Field>

              <Field label="Project">
                <Select
                  name="project"
                  value={form.project}
                  onChange={change}
                  options={lookups.projectOptions}
                  placeholder="No project"
                />
              </Field>

              {/* Naming the task is what lets approving this close it */}
              <Field
                label="Task"
                className="sm:col-span-2"
                hint="Optional. If you name one, approving this marks that task complete."
              >
                <Select
                  name="task"
                  value={form.task}
                  onChange={change}
                  options={lookups.taskOptions}
                  placeholder="Not for a specific task"
                />
              </Field>
            </>
          )}

          <Field
            label="Code"
            className="sm:col-span-2"
            hint="Paste the code, or leave it blank and link the repository below"
          >
            <Textarea
              name="code"
              value={form.code}
              onChange={change}
              rows={12}
              className="font-mono text-xs"
              placeholder="// paste your code here"
            />
          </Field>

          <Field label="Repository link" className="sm:col-span-2">
            <Input
              name="repoUrl"
              value={form.repoUrl}
              onChange={change}
              placeholder="https://github.com/..."
            />
          </Field>

          <Field label="Version note" className="sm:col-span-2">
            <Input
              name="note"
              value={form.note}
              onChange={change}
              placeholder="What changed in this version"
            />
          </Field>
        </form>
      </Modal>

      {viewing && (
        <CodeViewer
          key={viewing}
          api={employeeApi}
          base="/employee"
          id={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
