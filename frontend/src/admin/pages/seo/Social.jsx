import { useState } from "react";
import { Plus, Pencil, Trash2, TrendingUp } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import { POST_STATUS, SOCIAL_PLATFORMS } from "./constants";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

const BLANK_ACCOUNT = { client: "", platform: "instagram", handle: "", profileUrl: "", followers: "", status: "active" };
const BLANK_POST = {
  client: "",
  accounts: [],
  title: "",
  caption: "",
  hashtags: [],
  mediaNote: "",
  status: "idea",
  scheduledFor: "",
  assignedTo: "",
};

/* -------------------------------------------------------------- accounts */

function Accounts() {
  const crud = useCrud("seo/social-accounts");
  const lookups = useLookups();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK_ACCOUNT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);
  const [counting, setCounting] = useState(null);
  const [followers, setFollowers] = useState("");

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK_ACCOUNT);
    setForm(row ? { ...BLANK_ACCOUNT, ...row, client: row.client?._id || "" } : BLANK_ACCOUNT);
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, followers: Number(form.followers) || 0 };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this account");
    } finally {
      setSaving(false);
    }
  };

  const logFollowers = async () => {
    try {
      await adminApi.post(`/admin/seo/social-accounts/${counting._id}/followers`, {
        followers: Number(followers),
      });
      setCounting(null);
      setFollowers("");
      crud.refresh();
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not record that");
      setCounting(null);
    }
  };

  const columns = [
    {
      key: "handle",
      header: "Account",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.handle}</p>
          <p className="text-xs text-slate-400">{row.platform}</p>
        </div>
      ),
    },
    { key: "client", header: "Client", render: (row) => row.client?.name || "—" },
    {
      key: "followers",
      header: "Followers",
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCounting(row);
            setFollowers(row.followers || "");
          }}
          className="inline-flex items-center gap-1.5 rounded px-1 tabular-nums text-slate-900 hover:bg-blue-50"
        >
          {(row.followers || 0).toLocaleString("en-IN")}
          <TrendingUp size={13} className="text-slate-400" />
        </button>
      ),
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              open(row);
            }}
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Alert>{crud.error}</Alert>
      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search handles"
          onFilter={crud.setFilter}
          filters={[
            {
              key: "platform",
              value: crud.filters.platform,
              placeholder: "Any platform",
              options: SOCIAL_PLATFORMS,
            },
          ]}
        >
          <Button size="sm" onClick={() => open(null)}>
            <Plus size={14} />
            Add account
          </Button>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          emptyTitle="No social accounts yet"
          emptyMessage="Add the profiles you post to on a client's behalf."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit account" : "Add social account"}
        subtitle="The login belongs in the vault, not here"
        size="sm"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.handle.trim() || !form.client}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required>
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Pick a client"
            />
          </Field>
          <Field label="Platform">
            <Select
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
              options={SOCIAL_PLATFORMS}
            />
          </Field>
          <Field label="Handle" required>
            <Input
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              placeholder="@client"
            />
          </Field>
          <Field label="Followers now">
            <Input
              type="number"
              min="0"
              value={form.followers}
              onChange={(e) => setForm((f) => ({ ...f, followers: e.target.value }))}
            />
          </Field>
          <Field label="Profile URL" className="sm:col-span-2">
            <Input
              value={form.profileUrl}
              onChange={(e) => setForm((f) => ({ ...f, profileUrl: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(counting)}
        title={`Followers — ${counting?.handle}`}
        subtitle="Today's count. The report shows growth from this series."
        size="sm"
        onClose={() => setCounting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCounting(null)}>
              Cancel
            </Button>
            <Button onClick={logFollowers}>Record</Button>
          </>
        }
      >
        <Field label="Followers">
          <Input
            type="number"
            min="0"
            autoFocus
            value={followers}
            onChange={(e) => setFollowers(e.target.value)}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this account?"
        message={`${target?.handle} and its follower history will be removed.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await crud.remove(target._id);
          setTarget(null);
        }}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

/* ----------------------------------------------------------------- posts */

function Posts() {
  const [month, setMonth] = useState(thisMonth());
  const crud = useCrud("seo/posts", { initialFilters: { month: thisMonth() } });
  const lookups = useLookups();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK_POST);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [accountOptions, setAccountOptions] = useState([]);

  const open = async (row) => {
    setFormError("");
    setEditing(row || BLANK_POST);
    setForm(
      row
        ? {
            ...BLANK_POST,
            ...row,
            client: row.client?._id || "",
            accounts: (row.accounts || []).map((a) => a._id || a),
            assignedTo: row.assignedTo?._id || "",
            scheduledFor: row.scheduledFor ? row.scheduledFor.slice(0, 16) : "",
          }
        : BLANK_POST
    );

    const clientId = row?.client?._id;
    if (clientId) loadAccounts(clientId);
  };

  const loadAccounts = (clientId) => {
    adminApi
      .get("/admin/seo/social-accounts", { params: { client: clientId, limit: 100 } })
      .then(({ data }) =>
        setAccountOptions(
          (data.items || []).map((a) => ({ value: a._id, label: `${a.platform} · ${a.handle}` }))
        )
      )
      .catch(() => setAccountOptions([]));
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        ...form,
        scheduledFor: form.scheduledFor || null,
        assignedTo: form.assignedTo || null,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this post");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Post",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title || "Untitled"}</p>
          <p className="truncate text-xs text-slate-400">{row.caption?.slice(0, 60) || "—"}</p>
        </div>
      ),
    },
    { key: "client", header: "Client", render: (row) => row.client?.name || "—" },
    {
      key: "accounts",
      header: "Where",
      render: (row) =>
        row.accounts?.length ? (
          <span className="text-xs text-slate-600">
            {row.accounts.map((a) => a.platform).join(", ")}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "scheduledFor",
      header: "Due",
      render: (row) => <span className="text-slate-600">{day(row.scheduledFor)}</span>,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    { key: "assignedTo", header: "Who", render: (row) => row.assignedTo?.name || "—" },
  ];

  return (
    <>
      <Alert>{crud.error}</Alert>
      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search posts"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: POST_STATUS },
          ]}
        >
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              crud.setFilter("month", e.target.value);
            }}
            className="w-auto"
          />
          <Button size="sm" onClick={() => open(null)}>
            <Plus size={14} />
            New post
          </Button>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={open}
          emptyTitle="Nothing planned this month"
          emptyMessage="Add posts and walk them from idea to published."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit post" : "New post"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.client}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required>
            <Select
              value={form.client}
              onChange={(e) => {
                setForm((f) => ({ ...f, client: e.target.value, accounts: [] }));
                if (e.target.value) loadAccounts(e.target.value);
              }}
              options={lookups.clientOptions}
              placeholder="Pick a client"
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={POST_STATUS}
            />
          </Field>

          <Field label="Title" className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What this post is"
            />
          </Field>

          <Field label="Caption" className="sm:col-span-2">
            <Textarea
              rows={4}
              value={form.caption}
              onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
            />
          </Field>

          <Field label="Hashtags" hint="Comma separated, with or without the #" className="sm:col-span-2">
            <Input
              value={(form.hashtags || []).join(", ")}
              onChange={(e) =>
                setForm((f) => ({ ...f, hashtags: e.target.value.split(",").map((t) => t.trim()) }))
              }
            />
          </Field>

          <Field label="Goes out" hint="Date and time">
            <Input
              type="datetime-local"
              value={form.scheduledFor}
              onChange={(e) => setForm((f) => ({ ...f, scheduledFor: e.target.value }))}
            />
          </Field>

          <Field label="Assigned to">
            <Select
              value={form.assignedTo}
              onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
              options={lookups.staffOptions}
              placeholder="Nobody yet"
            />
          </Field>

          <Field
            label="Accounts"
            hint={form.client ? "Which profiles it goes to" : "Pick a client first"}
            className="sm:col-span-2"
          >
            <MultiSelect
              options={accountOptions}
              value={form.accounts}
              onChange={(value) => setForm((f) => ({ ...f, accounts: value }))}
              placeholder="Search accounts…"
              emptyLabel="No accounts for this client yet"
            />
          </Field>

          <Field label="Creative" hint="What the image or video is. The file itself lives in Files." className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.mediaNote}
              onChange={(e) => setForm((f) => ({ ...f, mediaNote: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ page */

export default function Social() {
  const [tab, setTab] = useState("posts");

  return (
    <div>
      <PageHeader title="Social" subtitle="The post calendar and the accounts it goes to" />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {[
          ["posts", "Post calendar"],
          ["accounts", "Accounts"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "posts" ? <Posts /> : <Accounts />}
    </div>
  );
}
