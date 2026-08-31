import { useEffect, useState } from "react";
import { Copy, Check, Download, ExternalLink, GitBranch } from "lucide-react";

import Modal from "./Modal";
import { Alert, Badge, Button, Loader } from "./ui";

/**
 * Reads one code submission and shows its versions. Used by all three panels —
 * the source it renders is whatever the server decided that viewer may see, so
 * the same component is safe everywhere.
 *
 * Mount it keyed by the submission id (`{id && <CodeViewer key={id} .../>}`) so
 * each record starts from a clean state instead of being reset in an effect.
 */
export default function CodeViewer({ api, base, id, onClose }) {
  const [item, setItem] = useState(null);
  const [canDownload, setCanDownload] = useState(false);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/code/${id}`)
      .then(({ data }) => {
        if (!active) return;
        setItem(data.item);
        setCanDownload(Boolean(data.canDownload));
        const versions = data.item.versions || [];
        setVersion(versions.length ? versions[versions.length - 1].version : null);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load this code");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base, id]);

  const versions = item?.versions || [];
  const current = versions.find((v) => v.version === version) || versions[versions.length - 1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current?.code || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Your browser blocked the clipboard");
    }
  };

  // Goes back to the server rather than saving the text already on screen, so
  // the download is checked and recorded like every other read.
  const download = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get(`${base}/code/${id}/download`, {
        params: { version: current?.version },
        responseType: "blob",
      });

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${item.title.replace(/[^a-zA-Z0-9]+/g, "-")}-v${current?.version}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not download this version");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={item?.title || "Code"}
      subtitle={
        item
          ? `${item.submittedBy?.name || "Unknown"} · ${item.language} · ${
              item.project?.name || "No project"
            }`
          : "Loading..."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {current?.code && (
            <Button variant="outline" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {canDownload && current?.code && (
            <Button loading={downloading} onClick={download}>
              <Download size={14} />
              Download
            </Button>
          )}
        </>
      }
    >
      <Alert>{error}</Alert>

      {loading ? (
        <Loader label="Loading code..." />
      ) : !item ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={item.status} />
            {item.approvedVersion > 0 && (
              <span className="text-xs text-slate-500">
                Approved up to v{item.approvedVersion}
              </span>
            )}
            {item.reviewNote && (
              <span className="text-xs text-slate-500">· {item.reviewNote}</span>
            )}
          </div>

          {item.description && <p className="text-sm text-slate-600">{item.description}</p>}

          {versions.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {versions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setVersion(v.version)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    v.version === current?.version
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  v{v.version}
                </button>
              ))}
            </div>
          )}

          {current && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Version {current.version} · {current.createdBy?.name || "—"} ·{" "}
                  {new Date(current.createdAt).toLocaleString("en-IN")}
                </span>
                {current.repoUrl && (
                  <a
                    href={current.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    <GitBranch size={13} />
                    Repository
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {current.note && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {current.note}
                </p>
              )}

              {current.code ? (
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-100">
                  <code>{current.code}</code>
                </pre>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
                  This version is a repository link — open it above.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
