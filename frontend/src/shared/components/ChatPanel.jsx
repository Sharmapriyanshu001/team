import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, MessagesSquare, Search, Lock } from "lucide-react";

import { initialsOf } from "../format";
import { getSocket } from "../realtime";
import { withMessage } from "../chat";
import { Alert, Button, Card, EmptyState, Loader, PageHeader } from "./ui";

const timeOf = (value) =>
  new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

// Each panel keeps its own token, and so its own socket connection.
const TOKEN_KEYS = {
  "/admin": "adminToken",
  "/leader": "leaderToken",
  "/employee": "employeeToken",
  "/client": "clientToken",
};

/**
 * Two-pane chat shared by all three panels.
 *
 * `api` + `base` point at that panel's endpoints and `tab` selects the room
 * list. Which bubbles sit on the right is decided by `currentUserId`, or by a
 * custom `mineWhen` predicate — clients have no staff id on their messages, so
 * the portal passes one in. When a tab has a single room (a leader's admin
 * thread, say) the room list is hidden.
 */
export default function ChatPanel({
  api,
  base,
  tab,
  title,
  subtitle,
  currentUserId,
  mineWhen,
}) {
  // ?room=<id> — see where it is applied below
  const [params] = useSearchParams();
  const wanted = params.get("room");

  const [rooms, setRooms] = useState([]);
  const [scope, setScope] = useState("");
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [live, setLive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const bottomRef = useRef(null);
  // Read inside socket handlers, which must not re-subscribe on every switch
  const scopeRef = useRef("");
  const activeIdRef = useRef("");

  const tokenKey = TOKEN_KEYS[base];

  useEffect(() => {
    let active = true;

    api
      .get(`${base}/chat/rooms/${tab}`)
      .then(({ data }) => {
        if (!active) return;
        setBlocked(false);
        setError("");
        setScope(data.scope || "");
        setRooms(data.rooms || []);
        if (data.rooms?.length) {
          /**
           * ?room=<id> opens straight onto one conversation.
           *
           * This is what a "Message" button somewhere else in the panel links
           * to — from an employee's record, say. Without it the button lands
           * on whoever happens to be first in the list, which is worse than
           * not having the button.
           *
           * Ignored when the id names nobody this account can talk to, so a
           * stale link falls back to the usual first room rather than showing
           * an empty thread.
           */
          const asked = wanted && data.rooms.find((room) => String(room.id) === String(wanted));

          setActiveId((current) =>
            asked
              ? asked.id
              : data.rooms.some((room) => String(room.id) === String(current))
                ? current
                : data.rooms[0].id
          );
          setLoadingMessages(true);
        }
      })
      .catch((err) => {
        if (!active) return;
        // A 403 here means the admin turned this tab off
        if (err.response?.status === 403) setBlocked(true);
        setError(err.response?.data?.message || "Could not load conversations");
      })
      .finally(() => active && setLoadingRooms(false));

    return () => {
      active = false;
    };
    // `wanted` is in the list so a link to a different room re-selects it
  }, [api, base, tab, reloadKey, wanted]);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /* ------------------------------------------------------ live updates */

  useEffect(() => {
    const socket = getSocket(tokenKey);
    if (!socket) return undefined;

    setLive(socket.connected);

    const onConnect = () => setLive(true);
    const onDisconnect = () => setLive(false);

    const onMessage = ({ scope: incomingScope, roomId, message }) => {
      if (incomingScope !== scopeRef.current) return;

      // The thread on screen grows; every other room just updates its preview.
      if (String(roomId) === String(activeIdRef.current)) {
        setMessages((prev) => withMessage(prev, message));
      }

      setRooms((prev) =>
        prev.map((room) =>
          String(room.id) === String(roomId)
            ? {
                ...room,
                lastMessage: message.text,
                lastMessageAt: message.createdAt,
                lastSender: message.senderName,
              }
            : room
        )
      );
    };

    // The admin switched a chat tab on or off — re-read what we may open
    const onPermissions = () => setReloadKey((key) => key + 1);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("chat:message", onMessage);
    socket.on("chat:permissions", onPermissions);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("chat:message", onMessage);
      socket.off("chat:permissions", onPermissions);
    };
  }, [tokenKey]);

  // Subscribe to every room in the list, not just the open one, so the sidebar
  // previews stay live too. Keyed on the ids so a preview update cannot loop.
  const roomIdsKey = useMemo(() => rooms.map((room) => room.id).join(","), [rooms]);

  useEffect(() => {
    const socket = getSocket(tokenKey);
    if (!socket || !scope || !roomIdsKey) return undefined;

    const ids = roomIdsKey.split(",");
    const join = () => ids.forEach((roomId) => socket.emit("chat:join", { scope, roomId }));

    join();
    // A dropped connection loses its rooms, so re-join once it is back
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
      ids.forEach((roomId) => socket.emit("chat:leave", { scope, roomId }));
    };
  }, [tokenKey, scope, roomIdsKey]);

  useEffect(() => {
    if (!activeId) return undefined;

    let active = true;

    api
      .get(`${base}/chat/${tab}/${activeId}`)
      .then(({ data }) => active && setMessages(data.messages || []))
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load messages");
      })
      .finally(() => active && setLoadingMessages(false));

    return () => {
      active = false;
    };
  }, [api, base, tab, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const openRoom = (roomId) => {
    if (roomId === activeId) return;
    setLoadingMessages(true);
    setMessages([]);
    setActiveId(roomId);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;

    setSending(true);
    try {
      const { data } = await api.post(`${base}/chat/${tab}/${activeId}`, { text: body });

      // The socket copy has very likely landed already — see shared/chat.js.
      // And if the room was switched while this was in flight, it belongs to
      // the thread that is no longer on screen, not to the one that is.
      if (String(activeIdRef.current) === String(activeId)) {
        setMessages((prev) => withMessage(prev, data.data));
      }
      setText("");
      setRooms((prev) =>
        prev.map((room) =>
          room.id === activeId
            ? { ...room, lastMessage: body, lastMessageAt: new Date().toISOString() }
            : room
        )
      );
    } catch (err) {
      setError(err.response?.data?.message || "Could not send the message");
    } finally {
      setSending(false);
    }
  };

  const activeRoom = rooms.find((room) => room.id === activeId);
  const filteredRooms = rooms.filter((room) =>
    room.name.toLowerCase().includes(query.toLowerCase())
  );
  const showRoomList = rooms.length > 1 || loadingRooms;

  const isMine =
    mineWhen || ((message) => String(message.sender || "") === String(currentUserId || ""));

  if (blocked) {
    return (
      <div>
        <PageHeader title={title} subtitle={subtitle} />
        <Card>
          <EmptyState
            icon={Lock}
            title="This chat is turned off"
            message="Your admin has disabled this conversation."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />

      <Alert>{error}</Alert>

      <Card className="overflow-hidden">
        <div
          className={`grid h-[640px] grid-cols-1 ${
            showRoomList ? "md:grid-cols-[280px_1fr]" : ""
          }`}
        >
          {/* ------------------------------------------------- room list */}
          {showRoomList && (
            <div className="flex flex-col border-r border-slate-200">
              <div className="border-b border-slate-100 p-3">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search conversations"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingRooms ? (
                  <Loader label="Loading..." />
                ) : !filteredRooms.length ? (
                  <p className="px-4 py-8 text-center text-xs text-slate-400">
                    No conversations found
                  </p>
                ) : (
                  filteredRooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => openRoom(room.id)}
                      className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left transition-colors last:border-0 ${
                        activeId === room.id ? "bg-blue-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          activeId === room.id ? "bg-blue-600 text-white" : "bg-slate-900 text-white"
                        }`}
                      >
                        {initialsOf(room.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900">
                            {room.name}
                          </span>
                          {room.lastMessageAt && (
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {timeOf(room.lastMessageAt)}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {room.lastMessage || room.subtitle || "No messages yet"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* --------------------------------------------------- thread */}
          <div className="flex min-w-0 flex-col bg-slate-50">
            {loadingRooms ? (
              <Loader />
            ) : !activeRoom ? (
              <EmptyState
                icon={MessagesSquare}
                title="No conversation yet"
                message="Once you have someone to talk to, the thread shows up here."
              />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                    {initialsOf(activeRoom.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {activeRoom.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {activeRoom.subtitle || "—"}
                    </p>
                  </div>

                  <span
                    title={live ? "Live — new messages appear instantly" : "Reconnecting..."}
                    className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        live ? "bg-blue-600" : "animate-pulse bg-slate-300"
                      }`}
                    />
                    {live ? "Live" : "Offline"}
                  </span>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {loadingMessages ? (
                    <Loader label="Loading messages..." />
                  ) : !messages.length ? (
                    <p className="py-10 text-center text-xs text-slate-400">
                      No messages yet — say hello.
                    </p>
                  ) : (
                    messages.map((message) => {
                      const mine = isMine(message);
                      return (
                        <div
                          key={message._id}
                          className={`flex ${mine ? "justify-end" : "justify-start"}`}
                        >
                          <div className="max-w-[75%]">
                            <div
                              className={`rounded-2xl px-3.5 py-2 text-sm ${
                                mine
                                  ? "rounded-br-sm bg-blue-600 text-white"
                                  : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200"
                              }`}
                            >
                              {message.text}
                            </div>
                            <p
                              className={`mt-1 text-[10px] text-slate-400 ${mine ? "text-right" : ""}`}
                            >
                              {message.senderName} · {timeOf(message.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                <form
                  onSubmit={handleSend}
                  className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
                >
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                  <Button type="submit" loading={sending} disabled={!text.trim()}>
                    <Send size={15} />
                    Send
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
