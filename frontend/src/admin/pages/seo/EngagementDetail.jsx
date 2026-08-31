import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, FileBarChart, Link2, Minus, Plus, Trash2 } from "lucide-react";

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
import { BACKLINK_STATUS, BACKLINK_TYPES, PRIORITY } from "./constants";

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

/**
 * Where a term sits, and which way it moved.
 *
 * Rank is one of the few numbers where smaller is better, which reads wrong
 * everywhere unless it is spelled out — so the arrow points the way the client
 * would say it moved, not the way the number did.
 */
function Rank({ current, previous }) {
  if (current === null || current === undefined)
    return <span className="text-slate-400">Not ranking</span>;

  const move = previous === null || previous === undefined ? null : previous - current;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`font-semibold tabular-nums ${
          current <= 3 ? "text-green-700" : current <= 10 ? "text-blue-700" : "text-slate-700"
        }`}
      >
        {current}
      </span>
      {move !== null && move !== 0 && (
        <span
          className={`inline-flex items-center text-xs ${
            move > 0 ? "text-green-600" : "text-red-600"
          }`}
        >
          {move > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {Math.abs(move)}
        </span>
      )}
      {move === 0 && <Minus size={12} className="text-slate-300" />}
    </span>
  );
}

export default function EngagementDetail() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addingKeywords, setAddingKeywords] = useState(false);
  const [terms, setTerms] = useState("");
  const [keywordMeta, setKeywordMeta] = useState({ location: "India", device: "desktop", priority: "medium" });
  const [savingKeywords, setSavingKeywords] = useState(false);

  const [ranking, setRanking] = useState(null);
  const [rankValue, setRankValue] = useState("");
  const [doomedKeyword, setDoomedKeyword] = useState(null);

  const [links, setLinks] = useState([]);
  const [addingLink, setAddingLink] = useState(false);
  const [link, setLink] = useState({ sourceUrl: "", anchorText: "", type: "guest_post", status: "live", authority: "" });
  const [savingLink, setSavingLink] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      adminApi.get(`/admin/seo/projects/${id}/detail`),
      adminApi.get("/admin/seo/backlinks", { params: { seoProject: id, limit: 100 } }),
    ])
      .then(([detail, backlinks]) => {
        setData(detail.data);
        setLinks(backlinks.data.items || []);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this engagement"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const addKeywords = async () => {
    setSavingKeywords(true);
    setError("");
    try {
      const list = terms
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await adminApi.post(`/admin/seo/projects/${id}/keywords`, { terms: list, ...keywordMeta });
      setAddingKeywords(false);
      setTerms("");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add those keywords");
    } finally {
      setSavingKeywords(false);
    }
  };

  const saveRank = async () => {
    try {
      await adminApi.post(`/admin/seo/projects/${id}/keywords/${ranking._id}/rank`, {
        position: rankValue === "" ? null : Number(rankValue),
      });
      setRanking(null);
      setRankValue("");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not record that rank");
      setRanking(null);
    }
  };

  const deleteKeyword = async () => {
    try {
      await adminApi.delete(`/admin/seo/projects/${id}/keywords/${doomedKeyword._id}`);
      setDoomedKeyword(null);
      load();
    } catch {
      setDoomedKeyword(null);
    }
  };

  const addLink = async () => {
    setSavingLink(true);
    setError("");
    try {
      await adminApi.post("/admin/seo/backlinks", {
        ...link,
        seoProject: id,
        authority: Number(link.authority) || 0,
        acquiredOn: new Date().toISOString(),
      });
      setAddingLink(false);
      setLink({ sourceUrl: "", anchorText: "", type: "guest_post", status: "live", authority: "" });
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add that backlink");
    } finally {
      setSavingLink(false);
    }
  };

  if (loading) return <Loader label="Loading engagement…" />;
  if (!data) return <Alert>{error || "Engagement not found"}</Alert>;

  const project = data.item;
  const keywords = data.keywords || [];
  const topTen = keywords.filter((k) => k.currentPosition && k.currentPosition <= 10).length;

  return (
    <div>
      <Link
        to="/admin/seo"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        All engagements
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {project.client?.name}
            {project.website && (
              <>
                {" · "}
                <a
                  href={project.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {project.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Badge value={project.service} />
            <Badge value={project.status} />
          </div>
        </div>

        <Link to={`/admin/seo/${id}/report`}>
          <Button variant="outline">
            <FileBarChart size={15} />
            Monthly report
          </Button>
        </Link>
      </div>

      <Alert>{error}</Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Keywords tracked", keywords.length],
          ["In the top 10", topTen],
          ["Live backlinks", data.liveBacklinks],
          ["Latest SEO score", data.latestAudit?.scores?.seo ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-lg font-semibold text-slate-900">{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Keywords"
          subtitle="Click a rank to record today's position"
          action={
            <Button size="sm" onClick={() => setAddingKeywords(true)}>
              <Plus size={14} />
              Add keywords
            </Button>
          }
        />

        {keywords.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            No keywords yet. Paste a list to start tracking.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Term</th>
                  <th className="px-4 py-2.5">Where</th>
                  <th className="px-4 py-2.5">Rank</th>
                  <th className="px-4 py-2.5">Best</th>
                  <th className="px-4 py-2.5">Checked</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {keywords.map((keyword) => (
                  <tr key={keyword._id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{keyword.term}</p>
                      {keyword.priority !== "medium" && (
                        <span className="text-[11px] text-slate-400">{keyword.priority} priority</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {keyword.location} · {keyword.device}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => {
                          setRanking(keyword);
                          setRankValue(keyword.currentPosition ?? "");
                        }}
                        className="rounded px-1 hover:bg-blue-50"
                      >
                        <Rank current={keyword.currentPosition} previous={keyword.previousPosition} />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">
                      {keyword.bestPosition ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {day(keyword.lastCheckedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setDoomedKeyword(keyword)}
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Backlinks"
          subtitle={`${links.filter((l) => l.status === "live").length} live of ${links.length}`}
          action={
            <Button size="sm" variant="outline" onClick={() => setAddingLink(true)}>
              <Link2 size={14} />
              Add link
            </Button>
          }
        />

        {links.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No backlinks recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {links.map((row) => (
              <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-[12rem] flex-1 truncate font-medium text-slate-900 hover:text-blue-600"
                >
                  {row.sourceDomain}
                </a>
                <span className="truncate text-xs text-slate-500">{row.anchorText || "—"}</span>
                {row.authority > 0 && (
                  <span className="text-xs text-slate-400">DA {row.authority}</span>
                )}
                <Badge value={row.status} />
                <span className="ml-auto text-xs text-slate-400">{day(row.acquiredOn)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- add keywords */}
      <Modal
        open={addingKeywords}
        title="Add keywords"
        subtitle="One per line, or comma separated. Terms already tracked are skipped."
        size="sm"
        onClose={() => setAddingKeywords(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingKeywords(false)}>
              Cancel
            </Button>
            <Button onClick={addKeywords} loading={savingKeywords} disabled={!terms.trim()}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Keywords">
            <Textarea
              rows={7}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={"plumber jaipur\nemergency plumber\nbathroom fitting near me"}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Location">
              <Input
                value={keywordMeta.location}
                onChange={(e) => setKeywordMeta((m) => ({ ...m, location: e.target.value }))}
              />
            </Field>
            <Field label="Device">
              <Select
                value={keywordMeta.device}
                onChange={(e) => setKeywordMeta((m) => ({ ...m, device: e.target.value }))}
                options={[
                  { value: "desktop", label: "Desktop" },
                  { value: "mobile", label: "Mobile" },
                ]}
              />
            </Field>
            <Field label="Priority">
              <Select
                value={keywordMeta.priority}
                onChange={(e) => setKeywordMeta((m) => ({ ...m, priority: e.target.value }))}
                options={PRIORITY}
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* --------------------------------------------------------- record rank */}
      <Modal
        open={Boolean(ranking)}
        title={ranking?.term}
        subtitle="Where it sits today. Leave blank if it is not in the top 100."
        size="sm"
        onClose={() => setRanking(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRanking(null)}>
              Cancel
            </Button>
            <Button onClick={saveRank}>Record</Button>
          </>
        }
      >
        <Field label="Position" hint="1 to 100, or blank for 'not ranking'">
          <Input
            type="number"
            min="1"
            max="100"
            autoFocus
            value={rankValue}
            onChange={(e) => setRankValue(e.target.value)}
          />
        </Field>
      </Modal>

      {/* ---------------------------------------------------------- add link */}
      <Modal
        open={addingLink}
        title="Add a backlink"
        size="sm"
        onClose={() => setAddingLink(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingLink(false)}>
              Cancel
            </Button>
            <Button onClick={addLink} loading={savingLink} disabled={!link.sourceUrl.trim()}>
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Page carrying the link" required className="sm:col-span-2">
            <Input
              value={link.sourceUrl}
              onChange={(e) => setLink((l) => ({ ...l, sourceUrl: e.target.value }))}
              placeholder="https://site.com/blog/post"
            />
          </Field>
          <Field label="Anchor text">
            <Input
              value={link.anchorText}
              onChange={(e) => setLink((l) => ({ ...l, anchorText: e.target.value }))}
            />
          </Field>
          <Field label="Authority" hint="0 if nobody checked">
            <Input
              type="number"
              min="0"
              max="100"
              value={link.authority}
              onChange={(e) => setLink((l) => ({ ...l, authority: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <Select
              value={link.type}
              onChange={(e) => setLink((l) => ({ ...l, type: e.target.value }))}
              options={BACKLINK_TYPES}
            />
          </Field>
          <Field label="Status">
            <Select
              value={link.status}
              onChange={(e) => setLink((l) => ({ ...l, status: e.target.value }))}
              options={BACKLINK_STATUS}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(doomedKeyword)}
        title="Stop tracking this keyword?"
        message={`"${doomedKeyword?.term}" and its whole rank history will be removed.`}
        confirmLabel="Remove"
        onConfirm={deleteKeyword}
        onClose={() => setDoomedKeyword(null)}
      />
    </div>
  );
}
