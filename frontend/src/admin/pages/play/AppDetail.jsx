import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Plus, Trash2, TriangleAlert } from "lucide-react";

import adminApi from "../../adminApi";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
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
} from "../../../shared/components/ui";
import { LISTING_LIMITS, RELEASE_STATUS, RELEASE_TRACKS } from "./constants";

const NEW_RELEASE = {
  versionName: "",
  versionCode: "",
  track: "production",
  rolloutPercent: 100,
  status: "draft",
  releaseNotes: "",
};

const date = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * A character counter that only speaks up when it matters.
 *
 * Google refuses a listing that is one character over, and refuses it after
 * the upload rather than before — so the count is worth showing, but a row of
 * grey numbers under every field is noise. It turns amber near the cap and red
 * past it, and is otherwise easy to ignore.
 */
function Counter({ value = "", limit }) {
  const used = value.length;
  const tone =
    used > limit ? "text-red-600" : used > limit * 0.9 ? "text-amber-600" : "text-slate-400";
  return (
    <span className={`text-xs tabular-nums ${tone}`}>
      {used}/{limit}
    </span>
  );
}

function ReleaseRow({ release, onStatus, onDelete }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-[9rem]">
          <p className="font-medium text-slate-900">{release.versionName}</p>
          <p className="text-xs text-slate-400">code {release.versionCode}</p>
        </div>

        <Badge value={release.track} />
        <Badge value={release.status} />

        {release.rolloutPercent < 100 && (
          <span className="text-xs text-amber-600">{release.rolloutPercent}% rollout</span>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span>{date(release.liveAt || release.submittedAt || release.createdAt)}</span>
          <button onClick={() => setOpen((v) => !v)} className="text-blue-600 hover:underline">
            {open ? "Hide" : "Edit"}
          </button>
          <button
            onClick={() => onDelete(release)}
            title="Delete release"
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {release.rejectionReason && (
        <div className="mx-4 mb-3 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-700">
          <span className="font-medium">Rejected: </span>
          {release.rejectionReason}
        </div>
      )}

      {release.releaseNotes && !open && (
        <p className="px-4 pb-3 text-xs text-slate-500">{release.releaseNotes}</p>
      )}

      {open && (
        <div className="grid gap-3 bg-slate-50/60 px-4 py-3 sm:grid-cols-3">
          <Field label="Status">
            <Select
              value={release.status}
              onChange={(e) => onStatus(release, { status: e.target.value })}
              options={RELEASE_STATUS}
            />
          </Field>
          <Field label="Track">
            <Select
              value={release.track}
              onChange={(e) => onStatus(release, { track: e.target.value })}
              options={RELEASE_TRACKS}
            />
          </Field>
          <Field label="Rollout %">
            <Input
              type="number"
              min="0"
              max="100"
              defaultValue={release.rolloutPercent}
              onBlur={(e) => onStatus(release, { rolloutPercent: Number(e.target.value) })}
            />
          </Field>
          <Field label="Rejection reason" className="sm:col-span-3" hint="Required once the status is Rejected">
            <Textarea
              rows={2}
              defaultValue={release.rejectionReason}
              onBlur={(e) => onStatus(release, { rejectionReason: e.target.value })}
              placeholder="What Google actually said — this is what stops the same mistake twice"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export default function AppDetail() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [listing, setListing] = useState(null);
  const [savingListing, setSavingListing] = useState(false);

  const [adding, setAdding] = useState(false);
  const [release, setRelease] = useState(NEW_RELEASE);
  const [savingRelease, setSavingRelease] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [doomed, setDoomed] = useState(null);

  const load = useCallback(() => {
    adminApi
      .get(`/admin/play/apps/${id}/detail`)
      .then(({ data: payload }) => {
        setData(payload);
        setListing({
          title: "",
          shortDescription: "",
          fullDescription: "",
          promoText: "",
          keywords: [],
          ...(payload.item.listing || {}),
        });
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this app"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const saveListing = async () => {
    setSavingListing(true);
    setError("");
    try {
      await adminApi.put(`/admin/play/apps/${id}`, {
        listing: {
          ...listing,
          keywords: (Array.isArray(listing.keywords) ? listing.keywords : [])
            .map((k) => k.trim())
            .filter(Boolean),
        },
      });
      setNotice("Store listing saved");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the listing");
    } finally {
      setSavingListing(false);
    }
  };

  const addRelease = async () => {
    setSavingRelease(true);
    setReleaseError("");
    try {
      await adminApi.post(`/admin/play/apps/${id}/releases`, {
        ...release,
        versionCode: Number(release.versionCode),
      });
      setAdding(false);
      setRelease(NEW_RELEASE);
      load();
    } catch (err) {
      setReleaseError(err.response?.data?.message || "Could not add this release");
    } finally {
      setSavingRelease(false);
    }
  };

  const patchRelease = async (row, patch) => {
    setError("");
    try {
      await adminApi.put(`/admin/play/apps/${id}/releases/${row._id}`, patch);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update that release");
    }
  };

  const deleteRelease = async () => {
    try {
      await adminApi.delete(`/admin/play/apps/${id}/releases/${doomed._id}`);
      setDoomed(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete that release");
      setDoomed(null);
    }
  };

  if (loading) return <Loader label="Loading app…" />;
  if (!data) return <Alert>{error || "App not found"}</Alert>;

  const app = data.item;
  const openAlerts = (data.alerts || []).filter((a) => !["resolved"].includes(a.status));

  return (
    <div>
      <Link
        to="/admin/play/apps"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        All apps
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{app.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{app.packageName}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge value={app.status} />
            <span className="text-slate-400">·</span>
            <span className="text-slate-600">{app.console?.name}</span>
            {app.client && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{app.client.name}</span>
              </>
            )}
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs text-slate-400">Live on Play</p>
          <p className="text-lg font-semibold text-slate-900">
            {app.liveVersionName || "Nothing yet"}
          </p>
          {app.lastReleaseAt && (
            <p className="text-xs text-slate-400">since {date(app.lastReleaseAt)}</p>
          )}
          {app.storeUrl && (
            <a
              href={app.storeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              Open on Play <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      <Alert>{error}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}

      {openAlerts.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <div className="px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <TriangleAlert size={15} />
              {openAlerts.length} policy notice{openAlerts.length === 1 ? "" : "s"} still open
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800">
              {openAlerts.map((alert) => (
                <li key={alert._id}>
                  <span className="font-medium">{alert.title}</span>
                  {alert.deadline && <span> — due {date(alert.deadline)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ------------------------------------------------------- releases */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Releases"
              subtitle="Newest first. Version codes must always climb."
              action={
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus size={14} />
                  Add release
                </Button>
              }
            />
            {data.releases.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Nothing has shipped yet.
              </p>
            ) : (
              data.releases.map((row) => (
                <ReleaseRow
                  key={row._id}
                  release={row}
                  onStatus={patchRelease}
                  onDelete={setDoomed}
                />
              ))
            )}
          </Card>
        </div>

        {/* -------------------------------------------------- store listing */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Store listing" subtitle="What ASO work actually changes" />
            <div className="space-y-4 px-4 py-4">
              <Field
                label={
                  <span className="flex items-center justify-between gap-2">
                    Title <Counter value={listing.title} limit={LISTING_LIMITS.title} />
                  </span>
                }
              >
                <Input
                  value={listing.title}
                  maxLength={LISTING_LIMITS.title}
                  onChange={(e) => setListing((l) => ({ ...l, title: e.target.value }))}
                />
              </Field>

              <Field
                label={
                  <span className="flex items-center justify-between gap-2">
                    Short description
                    <Counter value={listing.shortDescription} limit={LISTING_LIMITS.shortDescription} />
                  </span>
                }
              >
                <Textarea
                  rows={2}
                  value={listing.shortDescription}
                  maxLength={LISTING_LIMITS.shortDescription}
                  onChange={(e) => setListing((l) => ({ ...l, shortDescription: e.target.value }))}
                />
              </Field>

              <Field
                label={
                  <span className="flex items-center justify-between gap-2">
                    Full description
                    <Counter value={listing.fullDescription} limit={LISTING_LIMITS.fullDescription} />
                  </span>
                }
              >
                <Textarea
                  rows={8}
                  value={listing.fullDescription}
                  maxLength={LISTING_LIMITS.fullDescription}
                  onChange={(e) => setListing((l) => ({ ...l, fullDescription: e.target.value }))}
                />
              </Field>

              <Field
                label="Target keywords"
                hint="Play has no keyword field — these are what the text above is written around. Comma separated."
              >
                <Input
                  value={(listing.keywords || []).join(", ")}
                  onChange={(e) =>
                    setListing((l) => ({ ...l, keywords: e.target.value.split(",") }))
                  }
                  placeholder="invoice app, gst billing, small business"
                />
              </Field>

              <Button onClick={saveListing} loading={savingListing} className="w-full">
                Save listing
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={adding}
        title="Add a release"
        subtitle={`Version codes must be above ${app.liveVersionCode || 0}`}
        size="sm"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={addRelease}
              loading={savingRelease}
              disabled={!release.versionName.trim() || !release.versionCode}
            >
              Add release
            </Button>
          </>
        }
      >
        <Alert>{releaseError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Version name" required>
            <Input
              value={release.versionName}
              onChange={(e) => setRelease((r) => ({ ...r, versionName: e.target.value }))}
              placeholder="1.4.0"
            />
          </Field>
          <Field label="Version code" required>
            <Input
              type="number"
              min="1"
              value={release.versionCode}
              onChange={(e) => setRelease((r) => ({ ...r, versionCode: e.target.value }))}
            />
          </Field>
          <Field label="Track">
            <Select
              value={release.track}
              onChange={(e) => setRelease((r) => ({ ...r, track: e.target.value }))}
              options={RELEASE_TRACKS}
            />
          </Field>
          <Field label="Status">
            <Select
              value={release.status}
              onChange={(e) => setRelease((r) => ({ ...r, status: e.target.value }))}
              options={RELEASE_STATUS}
            />
          </Field>
          <Field label="Rollout %" className="sm:col-span-2">
            <Input
              type="number"
              min="0"
              max="100"
              value={release.rolloutPercent}
              onChange={(e) => setRelease((r) => ({ ...r, rolloutPercent: e.target.value }))}
            />
          </Field>
          <Field label="Release notes" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={release.releaseNotes}
              onChange={(e) => setRelease((r) => ({ ...r, releaseNotes: e.target.value }))}
              placeholder="What changed"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(doomed)}
        title="Delete this release?"
        message={`${doomed?.versionName} (code ${doomed?.versionCode}) will be removed from the history. If it was the live one, the app falls back to the previous live release.`}
        confirmLabel="Delete"
        onConfirm={deleteRelease}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
