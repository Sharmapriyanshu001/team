import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";

import Modal from "../components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  Select,
  Textarea,
} from "../components/ui";

const TRACKS = [
  { value: "internal", label: "Internal testing" },
  { value: "closed", label: "Closed testing" },
  { value: "open", label: "Open testing" },
  { value: "production", label: "Production" },
];

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "live", label: "Live" },
];

const BLANK = {
  versionName: "",
  versionCode: "",
  track: "production",
  rolloutPercent: 100,
  status: "submitted",
  releaseNotes: "",
};

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * One app, as a team member sees it.
 *
 * Read-only apart from adding a release, which is the thing they are actually
 * doing. The store listing and the app's own settings stay with the admin —
 * a listing edited by four people at once is how a title ends up wrong on a
 * Friday evening.
 */
export default function MyAppDetail({ api, base, homePath }) {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    api
      .get(`${base}/play/apps/${id}`)
      .then(({ data: payload }) => {
        setData(payload);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this app"))
      .finally(() => setLoading(false));
  }, [api, base, id]);

  useEffect(load, [load]);

  const add = async () => {
    setSaving(true);
    setFormError("");
    try {
      await api.post(`${base}/play/apps/${id}/releases`, {
        ...form,
        versionCode: Number(form.versionCode),
      });
      setAdding(false);
      setForm(BLANK);
      load();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add this release");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading app…" />;
  if (!data) return <Alert>{error || "App not found"}</Alert>;

  const app = data.item;

  return (
    <div>
      <Link
        to={homePath}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        My apps
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{app.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{app.packageName}</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Badge value={app.status} />
            <span className="text-slate-600">{app.console?.name}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Live on Play</p>
          <p className="text-lg font-semibold text-slate-900">{app.liveVersionName || "Nothing yet"}</p>
        </div>
      </div>

      <Alert>{error}</Alert>

      {app.listing?.fullDescription && (
        <Card className="mb-4">
          <CardHeader title="Store listing" subtitle="Read only — the admin owns this" />
          <div className="space-y-2 px-4 py-3 text-sm">
            <p className="font-medium text-slate-900">{app.listing.title}</p>
            <p className="text-slate-600">{app.listing.shortDescription}</p>
            <p className="whitespace-pre-wrap text-xs text-slate-500">
              {app.listing.fullDescription}
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Releases"
          subtitle="Version codes must always be higher than every code used before"
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add release
            </Button>
          }
        />

        {data.releases.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing has shipped yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.releases.map((release) => (
              <div key={release._id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[8rem]">
                    <p className="font-medium text-slate-900">{release.versionName}</p>
                    <p className="text-xs text-slate-400">code {release.versionCode}</p>
                  </div>
                  <Badge value={release.track} />
                  <Badge value={release.status} />
                  <span className="ml-auto text-xs text-slate-400">
                    {day(release.liveAt || release.submittedAt || release.createdAt)}
                    {release.createdByName && ` · ${release.createdByName}`}
                  </span>
                </div>
                {release.rejectionReason && (
                  <p className="mt-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-700">
                    <span className="font-medium">Rejected: </span>
                    {release.rejectionReason}
                  </p>
                )}
                {release.releaseNotes && (
                  <p className="mt-1 text-xs text-slate-500">{release.releaseNotes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={adding}
        title="Add a release"
        subtitle={`Version code must be above ${app.liveVersionCode || 0}`}
        size="sm"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={add}
              loading={saving}
              disabled={!form.versionName.trim() || !form.versionCode}
            >
              Add release
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Version name" required>
            <Input
              value={form.versionName}
              onChange={(e) => setForm((f) => ({ ...f, versionName: e.target.value }))}
              placeholder="1.4.0"
            />
          </Field>
          <Field label="Version code" required>
            <Input
              type="number"
              min="1"
              value={form.versionCode}
              onChange={(e) => setForm((f) => ({ ...f, versionCode: e.target.value }))}
            />
          </Field>
          <Field label="Track">
            <Select
              value={form.track}
              onChange={(e) => setForm((f) => ({ ...f, track: e.target.value }))}
              options={TRACKS}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={STATUSES}
            />
          </Field>
          <Field label="Release notes" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.releaseNotes}
              onChange={(e) => setForm((f) => ({ ...f, releaseNotes: e.target.value }))}
              placeholder="What changed in this build"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
