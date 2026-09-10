import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCheck } from "lucide-react";

import salesApi from "../salesApi";
import useSalesAccess from "../hooks/useSalesAccess";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Loader,
  PageHeader,
  Textarea,
} from "../../shared/components/ui";
import { money, shortDate } from "../constants";

/**
 * The day list.
 *
 * The screen a sales desk actually lives on: what did I promise, to whom, and
 * has the day gone by. Overdue is the default view rather than a filter you
 * have to find, because the whole point of the list is the things that have
 * slipped.
 *
 * Closing one opens the form that logs what happened AND books the next call,
 * because that is the single moment somebody has just put the phone down and
 * is willing to type. Split across three screens, the second two never happen.
 */

const VIEWS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
];

export default function FollowUps() {
  const { isSalesHead } = useSalesAccess();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState(params.get("view") || "today");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [closing, setClosing] = useState(null);
  const [closeForm, setCloseForm] = useState({ summary: "", nextDueOn: "", nextTitle: "" });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    salesApi
      .get("/sales/followups", { params: { view } })
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setCounts(data.counts || {});
        setError("");
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load follow-ups"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [view, reloadKey]);

  const pickView = (key) => {
    setView(key);
    setParams(key === "today" ? {} : { view: key }, { replace: true });
  };

  const openClose = (row) => {
    setCloseForm({ summary: "", nextDueOn: "", nextTitle: row.title });
    setClosing(row);
  };

  const confirmClose = async (status) => {
    if (!closing) return;
    setBusy(true);
    try {
      const { data } = await salesApi.put(`/sales/followups/${closing._id}/complete`, {
        status,
        summary: closeForm.summary,
        nextDueOn: closeForm.nextDueOn || undefined,
        nextTitle: closeForm.nextTitle || undefined,
      });
      setClosing(null);
      setNotice(
        data.next ? "Logged, and the next one is booked" : data.message || "Marked done"
      );
      reload();
    } catch (err) {
      setError(err.response?.data?.message || "Could not close that");
      setClosing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow-ups"
        subtitle={isSalesHead ? "Everything the floor owes" : "Everything you owe"}
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const count = counts[v.key];
          const active = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => pickView(v.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : v.key === "overdue" && count > 0
                    ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v.label}
              {count !== undefined && count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <Card>
        {loading ? (
          <Loader />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            {view === "overdue"
              ? "Nothing overdue. That is the right answer."
              : "Nothing here."}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((f) => {
              const late =
                f.status === "pending" &&
                new Date(f.dueOn) < new Date(new Date().setHours(0, 0, 0, 0));

              return (
                <div key={f._id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{f.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {f.lead?.name || f.client?.name || "—"}
                      {f.lead?.company ? ` · ${f.lead.company}` : ""}
                      {isSalesHead && f.assignedTo?.name ? ` · ${f.assignedTo.name}` : ""}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 text-xs ${late ? "font-medium text-red-600" : "text-slate-500"}`}
                  >
                    {shortDate(f.dueOn)}
                  </span>

                  <Badge value={f.mode} />

                  {f.status === "pending" ? (
                    <Button size="sm" variant="outline" onClick={() => openClose(f)}>
                      <CheckCheck size={13} /> Close
                    </Button>
                  ) : (
                    <Badge value={f.status} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* --------------------------------------------- close and book next */}

      <Modal
        open={Boolean(closing)}
        title="How did it go?"
        subtitle={closing?.title}
        onClose={() => setClosing(null)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => confirmClose("missed")}
              disabled={busy}
            >
              Could not reach them
            </Button>
            <Button onClick={() => confirmClose("done")} disabled={busy}>
              {busy ? "Saving…" : "Done"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What happened" hint="Goes into the lead's history">
            <Textarea
              rows={3}
              value={closeForm.summary}
              onChange={(e) => setCloseForm({ ...closeForm, summary: e.target.value })}
              placeholder="Spoke to them, sending a revised quote…"
            />
          </Field>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">
              Book the next one now — while you remember
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Next follow-up">
                <Input
                  type="date"
                  value={closeForm.nextDueOn}
                  onChange={(e) => setCloseForm({ ...closeForm, nextDueOn: e.target.value })}
                />
              </Field>
              <Field label="About">
                <Input
                  value={closeForm.nextTitle}
                  onChange={(e) => setCloseForm({ ...closeForm, nextTitle: e.target.value })}
                />
              </Field>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Leave the date blank if there is nothing to book.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
