import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";

import hrApi from "../../hrApi";
import useHrAccess from "../../hooks/useHrAccess";
import useHiringLookups from "../../hooks/useHiringLookups";
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
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import {
  EMPLOYMENT_TYPES,
  HIRE_AS_ROLES,
  OPENING_STATUS,
  dateInput,
  daysSince,
  openingStatusLabel,
  salaryBand,
  shortDate,
} from "../../../shared/hr/constants";

/**
 * The roles the company is trying to fill.
 *
 * The first link in the chain: every candidate hangs off one of these, and
 * "how is hiring going" is a question about vacancies rather than about
 * people. An opening is for a number of seats and fills itself when that many
 * have joined — the server closes it, so nobody has to remember to.
 */

const BLANK = {
  title: "",
  code: "",
  department: "",
  location: "",
  employmentType: "full_time",
  positions: 1,
  description: "",
  requirements: "",
  skills: "",
  experience: "",
  salaryMin: 0,
  salaryMax: 0,
  status: "open",
  hireAs: "employee",
  owner: "",
  reportsTo: "",
  targetDate: "",
};

export default function JobOpenings() {
  const navigate = useNavigate();
  const { can } = useHrAccess();
  const { staffOptions } = useHiringLookups();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    hrApi
      .get("/hr/hiring/openings", {
        params: { page, search: search || undefined, status: status || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load openings"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [page, search, status, reloadKey]);

  const openAdd = () => {
    setEditing("new");
    setForm(BLANK);
    setFormError("");
  };

  const openEdit = (row) => {
    setEditing(row._id);
    setForm({
      title: row.title || "",
      code: row.code || "",
      department: row.department || "",
      location: row.location || "",
      employmentType: row.employmentType || "full_time",
      positions: row.positions ?? 1,
      description: row.description || "",
      requirements: (row.requirements || []).join(", "),
      skills: (row.skills || []).join(", "),
      experience: row.experience || "",
      salaryMin: row.salaryMin ?? 0,
      salaryMax: row.salaryMax ?? 0,
      status: row.status || "open",
      hireAs: row.hireAs || "employee",
      owner: row.owner?._id || "",
      reportsTo: row.reportsTo?._id || "",
      targetDate: dateInput(row.targetDate),
    });
    setFormError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (editing === "new") await hrApi.post("/hr/hiring/openings", form);
      else await hrApi.put(`/hr/hiring/openings/${editing}`, form);

      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this opening");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await hrApi.delete(`/hr/hiring/openings/${target._id}`);
      setTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that opening");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "title",
      header: "Role",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.title}</p>
          <p className="text-xs text-slate-400">
            {row.code}
            {row.department ? ` · ${row.department}` : ""}
            {row.location ? ` · ${row.location}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "positions",
      header: "Seats",
      render: (row) => (
        <span className="font-medium text-slate-900">{row.positions ?? 1}</span>
      ),
    },
    {
      key: "salary",
      header: "Band",
      render: (row) => (
        <span className="text-slate-600">{salaryBand(row.salaryMin, row.salaryMax)}</span>
      ),
    },
    { key: "experience", header: "Experience", render: (row) => row.experience || "—" },
    { key: "owner", header: "Owner", render: (row) => row.owner?.name || "—" },
    {
      key: "openedOn",
      header: "Open for",
      render: (row) => {
        const days = daysSince(row.openedOn);
        const late =
          row.targetDate && new Date(row.targetDate) < new Date() && row.status === "open";
        return (
          <div>
            <p className={late ? "font-medium text-amber-600" : "text-slate-700"}>{days}d</p>
            {row.targetDate && (
              <p className="text-[11px] text-slate-400">by {shortDate(row.targetDate)}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge value={row.status}>{openingStatusLabel(row.status)}</Badge>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {can("hiring", "edit") && (
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
          {can("hiring", "delete") && (
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

  return (
    <div>
      <PageHeader title="Job Openings" subtitle={`${total} on record`}>
        {can("hiring", "create") && (
          <Button onClick={openAdd}>
            <Plus size={15} />
            Add Opening
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
          searchPlaceholder="Search by title, code, department or skill"
          onFilter={(key, value) => {
            setPage(1);
            if (key === "status") setStatus(value);
          }}
          filters={[
            { key: "status", value: status, placeholder: "Any status", options: OPENING_STATUS },
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
          onRowClick={(row) => navigate(`/hr/hiring/openings/${row._id}`)}
          emptyTitle="No job openings yet"
          emptyMessage="Add one, then attach candidates to it as they apply."
        />
      </Card>

      <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
        <Briefcase size={13} className="mt-0.5 shrink-0" />
        An opening closes itself once as many people have joined as it has seats — you do not have
        to remember to mark it filled.
      </p>

      {/* ------------------------------------------------------ add / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a job opening" : "Edit opening"}
        subtitle="Candidates attach to this, and the board measures the pipeline against its seats"
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

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Title" required className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="React Developer"
                required
              />
            </Field>
            <Field label="Code" hint="Generated if left blank">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="ENG-01"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Department">
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="Location">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
            <Field label="Seats" hint="Fills when this many join">
              <Input
                type="number"
                min="1"
                value={form.positions}
                onChange={(e) => setForm({ ...form, positions: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Employment type">
              <Select
                value={form.employmentType}
                onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                options={EMPLOYMENT_TYPES}
              />
            </Field>
            <Field label="Experience">
              <Input
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
                placeholder="2–4 years"
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={OPENING_STATUS}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Salary from">
              <Input
                type="number"
                min="0"
                value={form.salaryMin}
                onChange={(e) => setForm({ ...form, salaryMin: Number(e.target.value) })}
              />
            </Field>
            <Field label="Salary to">
              <Input
                type="number"
                min="0"
                value={form.salaryMax}
                onChange={(e) => setForm({ ...form, salaryMax: Number(e.target.value) })}
              />
            </Field>
            <Field label="Fill by">
              <Input
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
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

          <Field label="Requirements" hint="Comma separated">
            <Input
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              placeholder="Own laptop, immediate joiner"
            />
          </Field>

          <Field label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Hire as" hint="What the account is created as">
              <Select
                value={form.hireAs}
                onChange={(e) => setForm({ ...form, hireAs: e.target.value })}
                // Department roles create department logins, which only an
                // administrator may do — so they are not offered here
                options={HIRE_AS_ROLES.filter((r) => !r.label.includes("department account"))}
              />
            </Field>
            <Field label="Owner" hint="Who on HR is carrying it">
              <Select
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                options={staffOptions}
                placeholder="Nobody yet"
              />
            </Field>
            <Field label="Reports to">
              <Select
                value={form.reportsTo}
                onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}
                options={staffOptions}
                placeholder="Not decided"
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete job opening"
        message={`Delete "${target?.title}"? Candidates attached to it are kept, but lose their link to the vacancy. Closing it instead keeps the history.`}
        loading={deleting}
        onConfirm={remove}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
