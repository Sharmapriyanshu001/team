import { useEffect, useState } from "react";
import { FileCode, Eye, ShieldCheck, Share2, Trash2, History } from "lucide-react";

import adminApi from "../../adminApi";
import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import { prettify } from "../../../shared/format";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal from "../../../shared/components/Modal";
import CodeViewer from "../../../shared/components/CodeViewer";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";

const STATUSES = ["pending", "approved", "rejected"];

const GROUPS = [
  { value: "", label: "Only the people I pick" },
  { value: "project_team", label: "Entire project team" },
  { value: "all_employees", label: "All employees" },
  { value: "all_team_leaders", label: "All team leaders" },
];

const EMPTY_SHARE = { users: [], group: "", canDownload: true, note: "" };

/**
 * The admin's code desk: review what employees submitted, then decide exactly
 * who gets the approved version. Nobody — team leaders included — sees a
 * submission until it is handed over from here.
 */
export default function CodeReview() {
  const crud = useCrud("code");
  const lookups = useLookups();

  const [viewing, setViewing] = useState(null);

  // Review
  const [reviewing, setReviewing] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [decision, setDecision] = useState("");
  const [reviewError, setReviewError] = useState("");

  // Share / access
  const [sharing, setSharing] = useState(null); // list row being shared
  const [detail, setDetail] = useState(null); // full record with shares + trail
  const [detailLoading, setDetailLoading] = useState(false);
  const [shareForm, setShareForm] = useState(EMPTY_SHARE);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");

  // Opening the modal is what clears the form and switches the loader on, so
  // the effect below only ever sets state once the response lands.
  const openShare = (row) => {
    setDetail(null);
    setDetailLoading(true);
    setShareError("");
    setShareForm(EMPTY_SHARE);
    setPeopleSearch("");
    setSharing(row);
  };

  useEffect(() => {
    if (!sharing) return undefined;

    let active = true;

    adminApi
      .get(`/admin/code/${sharing._id}`)
      .then(({ data }) => active && setDetail(data.item))
      .catch((err) => active && setShareError(err.response?.data?.message || "Could not load access"))
      .finally(() => active && setDetailLoading(false));

    return () => {
      active = false;
    };
  }, [sharing]);

  const openReview = (row, choice) => {
    setReviewing(row);
    setDecision(choice);
    setReviewNote(row.reviewNote || "");
    setReviewError("");
  };

  const saveReview = async () => {
    setReviewError("");
    try {
      await adminApi.put(`/admin/code/${reviewing._id}/review`, {
        decision,
        note: reviewNote,
      });
      crud.refresh();
      setReviewing(null);
    } catch (err) {
      setReviewError(err.response?.data?.message || "Could not save the review");
    }
  };

  const toggleUser = (id) =>
    setShareForm((prev) => ({
      ...prev,
      users: prev.users.includes(id)
        ? prev.users.filter((u) => u !== id)
        : [...prev.users, id],
    }));

  const saveShare = async () => {
    setShareSaving(true);
    setShareError("");

    try {
      const { data } = await adminApi.post(`/admin/code/${sharing._id}/share`, shareForm);
      setDetail(data.item);
      setShareForm(EMPTY_SHARE);
      crud.refresh();
    } catch (err) {
      setShareError(err.response?.data?.message || "Could not share the code");
    } finally {
      setShareSaving(false);
    }
  };

  const revoke = async (userId) => {
    setShareError("");
    try {
      const { data } = await adminApi.delete(`/admin/code/${sharing._id}/share/${userId}`);
      setDetail(data.item);
      crud.refresh();
    } catch (err) {
      setShareError(err.response?.data?.message || "Could not revoke access");
    }
  };

  // Everyone who can legally receive code, minus the author who already has it
  const people = [...lookups.teamLeaders, ...lookups.employees].filter(
    (person) =>
      String(person._id) !== String(sharing?.submittedBy?._id) &&
      person.name.toLowerCase().includes(peopleSearch.toLowerCase())
  );

  const alreadyShared = new Set((detail?.sharedWith || []).map((row) => String(row.user?._id)));

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
              {row.language} · v{row.latestVersion} · {row.project?.name || "No project"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "submittedBy",
      header: "From",
      render: (row) => (
        <div>
          <p className="text-slate-900">{row.submittedBy?.name || "—"}</p>
          <p className="text-xs text-slate-400">{row.submittedBy?.designation || ""}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "approvedVersion",
      header: "Approved",
      render: (row) => (row.approvedVersion ? `v${row.approvedVersion}` : "—"),
    },
    {
      key: "shareCount",
      header: "Shared with",
      render: (row) =>
        row.shareCount ? (
          <span className="text-slate-900">{row.shareCount}</span>
        ) : (
          <span className="text-xs text-slate-400">Nobody</span>
        ),
    },
    {
      key: "createdAt",
      header: "Submitted",
      render: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
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
            title="Read the code"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={() => openReview(row, "approve")}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
            title="Review"
          >
            <ShieldCheck size={15} />
          </button>
          <button
            onClick={() => openShare(row)}
            disabled={!row.approvedVersion}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            title={row.approvedVersion ? "Manage access" : "Approve it before sharing"}
          >
            <Share2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Code Review"
        subtitle="Review what employees submit, then decide who may see it"
      />

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search submissions"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "status",
              value: crud.filters.status,
              placeholder: "All statuses",
              options: STATUSES.map((s) => ({ value: s, label: prettify(s) })),
            },
            {
              key: "submittedBy",
              value: crud.filters.submittedBy,
              placeholder: "All employees",
              options: lookups.employeeOptions,
            },
            {
              key: "view",
              value: crud.filters.view,
              placeholder: "Shared or not",
              options: [
                { value: "shared", label: "Already shared" },
                { value: "unshared", label: "Not shared yet" },
              ],
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
          emptyMessage="Submissions from the employee panel land here for review."
        />
      </Card>

      {/* ----------------------------------------------------------- review */}
      <Modal
        open={Boolean(reviewing)}
        size="sm"
        title="Review code"
        subtitle={reviewing?.title}
        onClose={() => setReviewing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button onClick={saveReview}>
              {decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <Alert>{reviewError}</Alert>

        <div className="space-y-4">
          <Field label="Decision">
            <Select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              options={[
                { value: "approve", label: "Approve — it can be shared" },
                { value: "reject", label: "Reject — send it back" },
              ]}
            />
          </Field>

          <Field label="Note for the employee">
            <Textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="What was good, or what to fix"
            />
          </Field>

          <p className="text-xs text-slate-500">
            Approving marks the newest version shareable. Rejecting only blocks that
            version — anything approved earlier stays with the people who already have it.
          </p>
        </div>
      </Modal>

      {/* ------------------------------------------------------------ share */}
      <Modal
        open={Boolean(sharing)}
        size="lg"
        title="Share code"
        subtitle={sharing ? `${sharing.title} · v${sharing.approvedVersion} approved` : ""}
        onClose={() => setSharing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setSharing(null)}>
              Done
            </Button>
            <Button
              loading={shareSaving}
              disabled={!shareForm.users.length && !shareForm.group}
              onClick={saveShare}
            >
              <Share2 size={14} />
              Share
            </Button>
          </>
        }
      >
        <Alert>{shareError}</Alert>

        {detailLoading ? (
          <Loader label="Loading access..." />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Share with" hint="A group is a shortcut — everyone is still stored one by one">
                <Select
                  value={shareForm.group}
                  onChange={(e) => setShareForm((prev) => ({ ...prev, group: e.target.value }))}
                  options={GROUPS}
                />
              </Field>

              <Field label="They may">
                <Select
                  value={shareForm.canDownload ? "download" : "view"}
                  onChange={(e) =>
                    setShareForm((prev) => ({
                      ...prev,
                      canDownload: e.target.value === "download",
                    }))
                  }
                  options={[
                    { value: "download", label: "View and download" },
                    { value: "view", label: "View only" },
                  ]}
                />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-slate-700">
                  Pick people{shareForm.users.length ? ` · ${shareForm.users.length} selected` : ""}
                </p>
                <Input
                  value={peopleSearch}
                  onChange={(e) => setPeopleSearch(e.target.value)}
                  placeholder="Search staff"
                  className="w-48 py-1 text-xs"
                />
              </div>

              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {people.map((person) => (
                  <label
                    key={person._id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={shareForm.users.includes(person._id)}
                      onChange={() => toggleUser(person._id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="flex-1 text-slate-800">{person.name}</span>
                    <span className="text-xs text-slate-400">{person.designation || ""}</span>
                    {alreadyShared.has(String(person._id)) && <Badge tone="blue">Has access</Badge>}
                  </label>
                ))}
                {!people.length && (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">Nobody matches</p>
                )}
              </div>
            </div>

            <Field label="Note for the recipients">
              <Input
                value={shareForm.note}
                onChange={(e) => setShareForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Why they are getting this"
              />
            </Field>

            {/* ------------------------------------------------ who has it */}
            <div>
              <p className="mb-2 text-xs font-medium text-slate-700">
                Who has access ({detail?.sharedWith?.length || 0})
              </p>
              <div className="rounded-lg border border-slate-200">
                {(detail?.sharedWith || []).map((row) => (
                  <div
                    key={row._id}
                    className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-900">{row.user?.name || "Removed user"}</p>
                      <p className="text-xs text-slate-400">
                        {prettify(row.user?.role)} · shared{" "}
                        {new Date(row.createdAt).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <Badge tone={row.canDownload ? "blue" : "slate"}>
                      {row.canDownload ? "Download" : "View only"}
                    </Badge>
                    <button
                      onClick={() => revoke(row.user?._id)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Revoke access"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!detail?.sharedWith?.length && (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">
                    Not shared with anyone yet
                  </p>
                )}
              </div>
            </div>

            {/* --------------------------------------------------- history */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <History size={13} />
                Access history
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2">
                {[...(detail?.accessLog || [])].reverse().map((entry) => (
                  <p key={entry._id} className="text-xs text-slate-600">
                    <span className="text-slate-400">
                      {new Date(entry.createdAt).toLocaleString("en-IN")}
                    </span>{" "}
                    · {entry.userName} {prettify(entry.action).toLowerCase()}
                    {entry.detail ? ` (${entry.detail})` : ""}
                  </p>
                ))}
                {!detail?.accessLog?.length && (
                  <p className="py-2 text-center text-xs text-slate-400">Nothing recorded yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {viewing && (
        <CodeViewer
          key={viewing}
          api={adminApi}
          base="/admin"
          id={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
