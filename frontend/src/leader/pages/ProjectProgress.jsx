import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, Save, ExternalLink } from "lucide-react";

import leaderApi from "../leaderApi";
import { STATUS_COLORS } from "../../shared/theme";
import { prettify } from "../../shared/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Loader,
  PageHeader,
  Select,
} from "../../shared/components/ui";

const STATUSES = ["planning", "in_progress", "on_hold", "completed"];

const fmt = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");

const deadlineLabel = (item) => {
  if (item.daysLeft === null) return "No deadline";
  if (item.status === "completed") return "Delivered";
  if (item.daysLeft < 0) return `${Math.abs(item.daysLeft)} days overdue`;
  if (item.daysLeft === 0) return "Due today";
  return `${item.daysLeft} days left`;
};

export default function ProjectProgress() {
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    leaderApi
      .get("/leader/progress")
      .then(({ data }) => {
        if (!active) return;
        setItems(data.items || []);
        setDrafts(
          (data.items || []).reduce(
            (acc, item) => ({ ...acc, [item.id]: { progress: item.progress, status: item.status } }),
            {}
          )
        );
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the progress board");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const setDraft = (id, patch) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async (item) => {
    setSavingId(item.id);
    setError("");
    setSuccess("");

    try {
      await leaderApi.put(`/leader/projects/${item.id}/progress`, drafts[item.id]);
      setSuccess(`${item.name} updated`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update the project");
    } finally {
      setSavingId("");
    }
  };

  if (loading) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Project Progress"
        subtitle="Slide each project to where it actually is — this feeds the admin dashboard"
      />

      <Alert>{error}</Alert>
      <Alert tone="success">{success}</Alert>

      {!items.length ? (
        <Card>
          <EmptyState
            icon={Gauge}
            title="No projects assigned"
            message="Once you lead a project it shows up here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const draft = drafts[item.id] || { progress: item.progress, status: item.status };
            const dirty =
              Number(draft.progress) !== item.progress || draft.status !== item.status;

            return (
              <Card key={item.id}>
                <CardHeader
                  title={item.name}
                  subtitle={`${item.client} · ${item.code || "no code"}`}
                  action={
                    <div className="flex items-center gap-2">
                      <Badge value={item.status} />
                      <Link
                        to={`/leader/projects/details?id=${item.id}`}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                        title="Open details"
                      >
                        <ExternalLink size={15} />
                      </Link>
                    </div>
                  }
                />

                <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_320px]">
                  {/* --------------------------------------------- slider */}
                  <div>
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="text-xs font-medium text-slate-500">Reported progress</span>
                      <span className="text-lg font-bold text-slate-900">{draft.progress}%</span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={draft.progress}
                      onChange={(e) => setDraft(item.id, { progress: Number(e.target.value) })}
                      className="w-full accent-blue-600"
                      style={{ accentColor: STATUS_COLORS[draft.status] || undefined }}
                    />

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["Tasks done", `${item.tasksCompleted} / ${item.tasks}`],
                        ["Task progress", `${item.taskProgress}%`],
                        ["Deadline", fmt(item.endDate)],
                        ["Time", deadlineLabel(item)],
                      ].map(([label, value], i) => (
                        <div key={label}>
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">
                            {label}
                          </p>
                          <p
                            className={`mt-0.5 text-sm font-medium ${
                              i === 3 && item.overdue ? "text-red-600" : "text-slate-800"
                            }`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ---------------------------------------------- status */}
                  <div className="space-y-3 rounded-lg bg-slate-50 p-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        Status
                      </label>
                      <Select
                        value={draft.status}
                        onChange={(e) => setDraft(item.id, { status: e.target.value })}
                        options={STATUSES}
                      />
                    </div>

                    <p className="text-[11px] text-slate-500">
                      Marking a project completed sets progress to 100%.
                    </p>

                    <Button
                      className="w-full"
                      disabled={!dirty}
                      loading={savingId === item.id}
                      onClick={() => save(item)}
                    >
                      <Save size={15} />
                      {dirty ? "Save changes" : "No changes"}
                    </Button>

                    <p className="text-center text-[11px] text-slate-400">
                      Currently {item.progress}% · {prettify(item.status)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
