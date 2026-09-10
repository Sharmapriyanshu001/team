import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, HandHeart, Users } from "lucide-react";

import salesApi from "../salesApi";
import DataTable from "../../shared/components/DataTable";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  ProgressBar,
  Select,
} from "../../shared/components/ui";
import useSalesAccess from "../hooks/useSalesAccess";
import { money, prettify, shortDate } from "../constants";

/**
 * What Sales sold, and who in Operations is building it.
 *
 * The handover used to be a notification and a hope: sales/clients/:id/project
 * opened the project with the agreed requirements in it, told Operations, and
 * left nobody's name on the record. It then sat in "planning" until somebody
 * happened to look at the board.
 *
 * This is the screen that closes that gap. The head names who is running the
 * delivery and, if they know it, who is on the team — and that is the whole of
 * Sales's authority over a project. The scope, the tasks, the dates and the
 * budget belong to whoever is answering for the delivery date, and there is no
 * route in this panel that touches any of them.
 *
 * An executive gets the same list, read-only, scoped to their own clients —
 * so they can answer "how is my client's build going" without ringing
 * Operations, and cannot change the answer.
 */

const STATUS_TONE = {
  planning: "slate",
  in_progress: "blue",
  on_hold: "amber",
  completed: "green",
  cancelled: "red",
};

export default function Projects() {
  const { isSalesHead } = useSalesAccess();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");

  const [handing, setHanding] = useState(null);
  const [team, setTeam] = useState({ items: [], teams: [] });
  const [form, setForm] = useState({ operationsManager: "", members: [], endDate: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    salesApi
      .get("/sales/projects", {
        params: { view: view === "all" ? undefined : view, search: search || undefined },
      })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setCanAssign(Boolean(data.canAssign));
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load projects"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [view, search, reloadKey]);

  /**
   * The names a project can go to. Fetched once, and only for the head — the
   * route refuses an executive, so asking would be a request that exists only
   * to be refused.
   */
  useEffect(() => {
    if (!isSalesHead) return;
    salesApi
      .get("/sales/delivery-team")
      .then(({ data }) => setTeam({ items: data.items || [], teams: data.teams || [] }))
      .catch(() => setTeam({ items: [], teams: [] }));
  }, [isSalesHead]);

  /**
   * Grouped, so the operations managers sit at the top. A flat list of sixty
   * names is one where somebody picks the wrong Rohit.
   */
  const leaderOptions = useMemo(
    () =>
      team.items
        .filter((p) => ["manager", "operations_manager"].includes(p.role))
        .map((p) => ({
          value: p._id,
          label: `${p.name}${p.designation ? ` — ${p.designation}` : ""} (${prettify(p.role)})`,
        })),
    [team.items]
  );

  const memberOptions = useMemo(
    () => team.items.filter((p) => p._id !== form.operationsManager),
    [team.items, form.operationsManager]
  );

  const openHandover = (row) => {
    setForm({
      operationsManager: row.operationsManager?._id || "",
      members: [],
      endDate: row.endDate ? new Date(row.endDate).toISOString().slice(0, 10) : "",
    });
    setFormError("");
    setHanding(row);
  };

  const hand = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const { data } = await salesApi.put(`/sales/projects/${handing._id}/assign`, {
        operationsManager: form.operationsManager,
        members: form.members,
        endDate: form.endDate || undefined,
      });
      setNotice(data.message || "Handed over");
      setHanding(null);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not hand that over");
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = (id) =>
    setForm((p) => ({
      ...p,
      members: p.members.includes(id)
        ? p.members.filter((m) => m !== id)
        : [...p.members, id],
    }));

  const columns = [
    {
      key: "name",
      header: "Project",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">
            {row.client?.name || "No client"}
            {row.code ? ` · ${row.code}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "operationsManager",
      header: "Running it",
      render: (row) =>
        row.operationsManager ? (
          <div>
            <p className="text-slate-800">{row.operationsManager.name}</p>
            <p className="text-xs text-slate-500">
              <Users size={11} className="mr-1 inline" />
              {row.teamSize} on the team
            </p>
          </div>
        ) : (
          <span className="text-xs font-medium text-amber-700">Nobody yet</span>
        ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (row) => (
        <div className="w-28">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{row.taskProgress}%</span>
            <span>
              {row.tasksCompleted}/{row.tasks}
            </span>
          </div>
          <ProgressBar value={row.taskProgress} />
        </div>
      ),
    },
    {
      key: "estimatedDate",
      header: "Expected finish",
      render: (row) => (
        <span
          className={`text-xs ${row.behindPlan ? "font-medium text-amber-700" : "text-slate-600"}`}
          title={row.estimateBasis}
        >
          <CalendarClock size={11} className="mr-1 inline" />
          {row.estimatedDate ? shortDate(row.estimatedDate) : "Not yet clear"}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      render: (row) => <span className="text-slate-700">{money(row.value)}</span>,
    },
    {
      key: "status",
      header: "Stage",
      render: (row) => <Badge value={prettify(row.status)} tone={STATUS_TONE[row.status]} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canAssign ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant={row.assigned ? "ghost" : "primary"}
              onClick={(e) => {
                e.stopPropagation();
                openHandover(row);
              }}
            >
              <HandHeart size={13} /> {row.assigned ? "Reassign" : "Hand over"}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery"
        subtitle={
          isSalesHead
            ? "What you sold, who is building it, and when it will actually be done"
            : "How your clients' projects are going"
        }
      >
        <Select
          value={view}
          onChange={(e) => setView(e.target.value)}
          className="w-44"
          options={[
            { value: "all", label: "Every project" },
            ...(canAssign ? [{ value: "unassigned", label: "Nobody on it" }] : []),
            { value: "in_progress", label: "Under way" },
            { value: "completed", label: "Finished" },
          ]}
        />
      </PageHeader>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: "Projects", value: counts.total ?? 0 },
          {
            // The number this screen exists for: sold, and nobody is on it
            label: "Waiting for a team",
            value: counts.unassigned ?? 0,
            tone: (counts.unassigned ?? 0) > 0 ? "text-amber-700" : "text-slate-900",
          },
          { label: "Under way", value: counts.live ?? 0, tone: "text-blue-700" },
          { label: "Finished", value: counts.done ?? 0, tone: "text-green-700" },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-0.5 text-xl font-semibold ${s.tone || "text-slate-900"}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-slate-200 p-3">
          <Input
            placeholder="Search project or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="Nothing sold yet"
          emptyMessage="A project opened from a won client appears here, ready to hand to Operations."
        />
      </Card>

      {/* -------------------------------------------------------- handover */}

      <Modal
        open={Boolean(handing)}
        title={`Hand over ${handing?.name || ""}`}
        subtitle="Whoever you name is told, and the project starts"
        onClose={() => setHanding(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setHanding(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={hand} disabled={busy || !form.operationsManager}>
              {busy ? "Handing over…" : "Hand it over"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={hand}>
          {formError && <Alert>{formError}</Alert>}

          <Field
            label="Who runs it"
            required
            hint="An operations manager or an operations manager — they answer for the date"
          >
            <Select
              value={form.operationsManager}
              onChange={(e) => setForm((p) => ({ ...p, operationsManager: e.target.value }))}
              placeholder="Choose somebody"
              options={leaderOptions}
              required
            />
          </Field>

          <Field
            label="Anybody else on it"
            hint="Optional — the manager can add the rest of the team themselves"
          >
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {memberOptions.length === 0 && (
                <p className="p-1 text-xs text-slate-500">Nobody else to add.</p>
              )}
              {memberOptions.map((p) => (
                <label
                  key={p._id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={form.members.includes(p._id)}
                    onChange={() => toggleMember(p._id)}
                    className="accent-blue-600"
                  />
                  <span className="text-slate-800">{p.name}</span>
                  <span className="text-xs text-slate-400">
                    {p.designation || prettify(p.role)}
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Target finish" hint="Optional — leave blank to keep what was agreed">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            />
          </Field>

          <p className="text-xs text-slate-500">
            Handing over moves the project out of planning and into delivery. After this, the
            scope, the tasks and the dates belong to whoever is running it — Sales can read the
            progress but not change it.
          </p>
        </form>
      </Modal>
    </div>
  );
}
