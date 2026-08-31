import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { Alert, Badge, Card, CardHeader, EmptyState, Loader, PageHeader } from "../components/ui";

const day = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "No date";

/**
 * The SEO and social work one staff member is on.
 *
 * Read-only. Recording ranks and moving a post through approval stay with the
 * admin for now — the point of this screen is that somebody assigned to three
 * retainers can see what is theirs without being handed the whole panel.
 */
export default function MySeoWork({ api, base }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/seo/my-work`)
      .then(({ data: payload }) => active && setData(payload))
      .catch((err) => active && setError(err.response?.data?.message || "Could not load your work"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base]);

  if (loading) return <Loader label="Loading your SEO work…" />;

  const engagements = data?.engagements || [];
  const posts = data?.posts || [];

  return (
    <div>
      <PageHeader
        title="SEO & Social"
        subtitle={`${engagements.length} engagement${engagements.length === 1 ? "" : "s"} · ${
          data?.keywordCount || 0
        } keywords tracked`}
      />

      <Alert>{error}</Alert>

      <Card className="mb-4">
        <CardHeader title="Your engagements" />
        {engagements.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nothing assigned yet"
            message="When an admin puts you on an SEO or social retainer it appears here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {engagements.map((row) => (
              <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-400">
                    {row.client?.name}
                    {row.website && ` · ${row.website.replace(/^https?:\/\//, "")}`}
                  </p>
                </div>
                <Badge value={row.service} />
                <Badge value={row.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Posts waiting on somebody" subtitle="Anything not yet published" />
        {posts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing outstanding.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {posts.map((post) => (
              <div key={post._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900">{post.title || "Untitled"}</p>
                  <p className="text-xs text-slate-400">
                    {post.client?.name}
                    {post.accounts?.length > 0 &&
                      ` · ${post.accounts.map((a) => a.platform).join(", ")}`}
                  </p>
                </div>
                <Badge value={post.status} />
                <span className="ml-auto text-xs text-slate-400">{day(post.scheduledFor)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
