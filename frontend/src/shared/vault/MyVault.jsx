import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, KeyRound } from "lucide-react";

import Modal from "../components/Modal";
import { Alert, Badge, Button, Card, EmptyState, Loader, PageHeader } from "../components/ui";

/**
 * The credentials shared with this person, and nothing else.
 *
 * Same rule as the admin's screen: the list never carries a secret, revealing
 * one is a deliberate request, and the server writes down who did it. An
 * employee who can see a hosting login here could see it in a spreadsheet
 * anyway — the difference is that here there is a record.
 */
export default function MyVault({ api, base }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [revealed, setRevealed] = useState(null);
  const [revealError, setRevealError] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    api
      .get(`${base}/vault`)
      .then(({ data }) => {
        setRows(data.items || []);
        setError("");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not open the vault"))
      .finally(() => setLoading(false));
  }, [api, base]);

  useEffect(load, [load]);

  const reveal = async (row) => {
    setRevealError("");
    setCopied("");
    try {
      const { data } = await api.post(`${base}/vault/${row._id}/reveal`, {});
      setRevealed({ ...data, username: row.username, url: row.url });
    } catch (err) {
      setRevealError(err.response?.data?.message || "Could not reveal this secret");
      setRevealed({ label: row.label, secret: "", notes: "" });
    }
  };

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  if (loading) return <Loader label="Opening the vault…" />;

  return (
    <div>
      <PageHeader
        title="Vault"
        subtitle="Logins shared with you. Opening one is recorded against your name."
      />

      <Alert>{error}</Alert>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="Nothing shared with you"
            message="When an admin shares a login it appears here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium text-slate-900">{row.label}</p>
                  <p className="text-xs text-slate-400">
                    {row.username || "no username"}
                    {row.client?.name && ` · ${row.client.name}`}
                    {row.hint && ` · ${row.hint}`}
                  </p>
                </div>

                <Badge value={row.type} />

                {row.url && (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-blue-600 hover:underline"
                  >
                    {row.url.replace(/^https?:\/\//, "").slice(0, 30)}
                  </a>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => reveal(row)}
                  disabled={!row.hasSecret}
                >
                  <Eye size={14} />
                  Reveal
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(revealed)}
        title={revealed?.label}
        subtitle="This has been recorded against your name"
        size="sm"
        onClose={() => {
          setRevealed(null);
          setCopied("");
        }}
        footer={
          <Button
            onClick={() => {
              setRevealed(null);
              setCopied("");
            }}
          >
            Done
          </Button>
        }
      >
        <Alert>{revealError}</Alert>

        {revealed?.secret && (
          <div className="space-y-3">
            {revealed.username && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-700">Username</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">
                    {revealed.username}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(revealed.username, "username")}
                  >
                    <Copy size={13} />
                    {copied === "username" ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Password</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">
                  {revealed.secret}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(revealed.secret, "secret")}>
                  <Copy size={13} />
                  {copied === "secret" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            {revealed.notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-700">Notes</p>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs">
                  {revealed.notes}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
