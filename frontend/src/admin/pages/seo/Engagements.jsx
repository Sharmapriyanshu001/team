import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, FileBarChart } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
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
import { SEO_SERVICES, SEO_STATUS } from "./constants";

const BLANK = {
  name: "",
  client: "",
  website: "",
  service: "seo",
  status: "active",
  monthlyFee: "",
  reportDay: 1,
  competitors: [],
  notes: "",
  teamLeaders: [],
  employees: [],
};

const money = (value) =>
  value ? `₹${Number(value).toLocaleString("en-IN")}` : <span className="text-slate-400">—</span>;

export default function Engagements() {
  const navigate = useNavigate();
  const crud = useCrud("seo/projects");
  const lookups = useLookups();

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || "",
            monthlyFee: row.monthlyFee || "",
            competitors: row.competitors || [],
            teamLeaders: (row.teamLeaders || []).map((u) => u._id || u),
            employees: (row.employees || []).map((u) => u._id || u),
          }
        : BLANK
    );
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...form, monthlyFee: Number(form.monthlyFee) || 0 };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this engagement");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await crud.remove(target._id);
      setTarget(null);
    } catch (err) {
      crud.setError(err.response?.data?.message || "Could not delete");
      setTarget(null);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Engagement",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">{row.website || "no website set"}</p>
        </div>
      ),
    },
    { key: "client", header: "Client", render: (row) => row.client?.name || "—" },
    { key: "service", header: "Service", render: (row) => <Badge value={row.service} /> },
    { key: "monthlyFee", header: "Monthly", render: (row) => money(row.monthlyFee) },
    {
      key: "team",
      header: "Team",
      render: (row) => {
        const names = [...(row.teamLeaders || []), ...(row.employees || [])].map((u) => u.name);
        return names.length ? (
          <span className="text-slate-700">
            {names.slice(0, 2).join(", ")}
            {names.length > 2 && <span className="text-slate-400"> +{names.length - 2}</span>}
          </span>
        ) : (
          <span className="text-slate-400">Nobody yet</span>
        );
      },
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
              navigate(`/admin/seo/${row._id}/report`);
            }}
            title="Monthly report"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <FileBarChart size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              open(row);
            }}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
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
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="SEO & Social"
        subtitle={`${crud.total} engagement${crud.total === 1 ? "" : "s"} on retainer`}
      >
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          New engagement
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name or website"
          onFilter={crud.setFilter}
          filters={[
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: SEO_STATUS },
            { key: "service", value: crud.filters.service, placeholder: "Any service", options: SEO_SERVICES },
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
          onRowClick={(row) => navigate(`/admin/seo/${row._id}`)}
          emptyTitle="No engagements yet"
          emptyMessage="Add a client retainer to start tracking keywords, backlinks and posts."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? "Edit engagement" : "New engagement"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim() || !form.client}>
              {editing?._id ? "Save changes" : "Create"}
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Rank Co — SEO retainer"
            />
          </Field>

          <Field label="Client" required>
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Pick a client"
            />
          </Field>

          <Field label="Website">
            <Input
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="https://client.com"
            />
          </Field>

          <Field label="Service">
            <Select
              value={form.service}
              onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
              options={SEO_SERVICES}
            />
          </Field>

          <Field label="Monthly fee" hint="What they pay, so effort can be weighed against it">
            <Input
              type="number"
              min="0"
              value={form.monthlyFee}
              onChange={(e) => setForm((f) => ({ ...f, monthlyFee: e.target.value }))}
            />
          </Field>

          <Field label="Report due on" hint="Day of the month">
            <Input
              type="number"
              min="1"
              max="28"
              value={form.reportDay}
              onChange={(e) => setForm((f) => ({ ...f, reportDay: Number(e.target.value) }))}
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={SEO_STATUS}
            />
          </Field>

          <Field label="Competitors" hint="Comma separated — who else ranks for these terms">
            <Input
              value={(form.competitors || []).join(", ")}
              onChange={(e) =>
                setForm((f) => ({ ...f, competitors: e.target.value.split(",").map((c) => c.trim()) }))
              }
            />
          </Field>

          <Field label="Team leaders" className="sm:col-span-2">
            <MultiSelect
              options={lookups.leaderOptions}
              value={form.teamLeaders}
              onChange={(value) => setForm((f) => ({ ...f, teamLeaders: value }))}
              placeholder="Search team leaders…"
              emptyLabel="No team leaders on record"
            />
          </Field>

          <Field label="Employees" className="sm:col-span-2">
            <MultiSelect
              options={lookups.employeeOptions}
              value={form.employees}
              onChange={(value) => setForm((f) => ({ ...f, employees: value }))}
              placeholder="Search employees…"
              emptyLabel="No employees on record"
            />
          </Field>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this engagement?"
        message={`"${target?.name}" goes. Its keywords, audits and backlinks stay in the database but will no longer be reachable — end it instead if the client may come back.`}
        confirmLabel="Delete"
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
