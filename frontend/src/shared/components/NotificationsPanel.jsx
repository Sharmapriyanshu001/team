import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  FolderKanban,
  ListChecks,
  ClipboardCheck,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";

import { prettify } from "../format";
import useLiveNotifications from "../hooks/useLiveNotifications";
import { Alert, Button, Card, EmptyState, Loader, PageHeader, Select } from "./ui";

const TYPE_ICONS = {
  general: Bell,
  project: FolderKanban,
  task: ListChecks,
  review: ClipboardCheck,
  issue: AlertTriangle,
  chat: MessageSquare,
  system: Bell,
};

const TYPES = ["general", "project", "task", "review", "issue", "chat", "system"];

const timeAgo = (value) => {
  const diff = Math.floor((Date.now() - new Date(value)) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(value).toLocaleDateString("en-IN");
};

/** Notification inbox shared by the leader and employee panels. */
export default function NotificationsPanel({ api, base, onRead }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/notifications`, { params: { filter, type: type || undefined } })
      .then(({ data }) => {
        if (!active) return;
        setItems(data.items || []);
        setUnread(data.unread || 0);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load notifications");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [api, base, filter, type, reloadKey]);

  const reload = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  /**
   * A notification pushed while this page is open refreshes it in place.
   *
   * Deliberately re-fetches rather than prepending the row it was handed: the
   * list is filtered by read state and type, and a new arrival does not always
   * belong in the view somebody is currently looking at. Re-asking keeps the
   * filter honest.
   *
   * No spinner — the list is already on screen and flashing it to a loader on
   * every arrival is worse than the second of staleness it saves.
   */
  useLiveNotifications(base, () => setReloadKey((key) => key + 1));

  const changeFilter = (value) => {
    setLoading(true);
    setFilter(value);
  };

  const changeType = (value) => {
    setLoading(true);
    setType(value);
  };

  const markOne = async (item) => {
    if (item.read) return;
    try {
      await api.put(`${base}/notifications/${item._id}/read`);
      setItems((prev) => prev.map((n) => (n._id === item._id ? { ...n, read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
      onRead?.();
    } catch {
      setError("Could not mark that as read");
    }
  };

  const markAll = async () => {
    setMarking(true);
    try {
      await api.put(`${base}/notifications/read-all`);
      onRead?.();
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not mark everything as read");
    } finally {
      setMarking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
      >
        <Select
          value={filter}
          onChange={(e) => changeFilter(e.target.value)}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread only" },
          ]}
          className="w-auto"
        />
        <Select
          value={type}
          onChange={(e) => changeType(e.target.value)}
          placeholder="All types"
          options={TYPES.map((t) => ({ value: t, label: prettify(t) }))}
          className="w-auto"
        />
        <Button variant="outline" loading={marking} onClick={markAll} disabled={!unread}>
          <CheckCheck size={15} />
          Mark all read
        </Button>
      </PageHeader>

      <Alert>{error}</Alert>

      <Card>
        {loading ? (
          <Loader />
        ) : !items.length ? (
          <EmptyState
            icon={Bell}
            title="Nothing here"
            message="New assignments, review outcomes and messages will show up here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const Icon = TYPE_ICONS[item.type] || Bell;
              const body = (
                <div
                  className={`flex gap-3 px-5 py-4 transition-colors hover:bg-slate-50 ${
                    item.read ? "" : "bg-blue-50/40"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      item.read ? "bg-slate-100 text-slate-500" : "bg-blue-600 text-white"
                    }`}
                  >
                    <Icon size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-sm ${
                          item.read ? "text-slate-700" : "font-semibold text-slate-900"
                        }`}
                      >
                        {item.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {timeAgo(item.createdAt)}
                      </span>
                    </div>
                    {item.message && <p className="mt-0.5 text-xs text-slate-500">{item.message}</p>}
                  </div>

                  {!item.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                </div>
              );

              return item.link ? (
                <Link key={item._id} to={item.link} onClick={() => markOne(item)} className="block">
                  {body}
                </Link>
              ) : (
                <button
                  key={item._id}
                  onClick={() => markOne(item)}
                  className="block w-full text-left"
                >
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
