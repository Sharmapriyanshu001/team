import { useState } from "react";
import { Plus, Star, MessageSquareQuote } from "lucide-react";

import { useCrud } from "../hooks/crud";
import useLookups from "../hooks/useLookups";
import { prettify, initialsOf } from "../../shared/format";
import Modal from "../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Loader,
  PageHeader,
  Select,
  Textarea,
} from "../../shared/components/ui";

const CATEGORIES = ["quality", "communication", "timeliness", "budget", "overall"];

const EMPTY = { project: "", category: "overall", rating: 5, message: "" };

const fmt = (value) =>
  new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function StarPicker({ value, onChange, size = 24 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="rounded p-0.5 hover:bg-slate-100"
        >
          <Star
            size={size}
            className={star <= value ? "fill-blue-600 text-blue-600" : "text-slate-300"}
          />
        </button>
      ))}
      <span className="ml-2 text-xs text-slate-500">{value} / 5</span>
    </div>
  );
}

function Stars({ value, size = 14 }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={star <= value ? "fill-blue-600 text-blue-600" : "text-slate-300"}
        />
      ))}
    </span>
  );
}

export default function Feedback() {
  const crud = useCrud("feedback");
  const lookups = useLookups();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const change = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      await crud.create({ ...form, rating: Number(form.rating) });
      setOpen(false);
      setForm(EMPTY);
      setSuccess("Thanks — your feedback has gone to the team.");
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not send your feedback");
    } finally {
      setSaving(false);
    }
  };

  // The list endpoint returns a summary alongside the rows
  const summary = crud.rows.length
    ? {
        avg:
          Math.round(
            (crud.rows.reduce((sum, f) => sum + f.rating, 0) / crud.rows.length) * 10
          ) / 10,
        count: crud.rows.length,
        awaiting: crud.rows.filter((f) => !f.response).length,
      }
    : { avg: 0, count: 0, awaiting: 0 };

  return (
    <div>
      <PageHeader
        title="Feedback"
        subtitle="Tell us how we're doing — the team reads every one of these"
      >
        <Button onClick={() => setOpen(true)}>
          <Plus size={15} />
          Give Feedback
        </Button>
      </PageHeader>

      <Alert>{crud.error}</Alert>
      <Alert tone="success">{success}</Alert>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium text-slate-500">Your average rating</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {summary.avg ? `${summary.avg} / 5` : "—"}
          </p>
          <div className="mt-2">
            <Stars value={Math.round(summary.avg)} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-slate-500">Feedback shared</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{summary.count}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-slate-500">Awaiting a reply</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{summary.awaiting}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Everything you've shared" subtitle="Newest first" />

        {crud.loading ? (
          <Loader />
        ) : !crud.rows.length ? (
          <EmptyState
            icon={MessageSquareQuote}
            title="No feedback yet"
            message="Rate a project and tell us what went well or what needs work."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {crud.rows.map((item) => (
              <div key={item._id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars value={item.rating} />
                      <Badge tone="slate">{prettify(item.category)}</Badge>
                      <Badge value={item.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {item.project?.name || "General"} · {fmt(item.createdAt)}
                    </p>
                  </div>
                </div>

                {item.message && <p className="mt-3 text-sm text-slate-700">{item.message}</p>}

                {item.response ? (
                  <div className="mt-3 rounded-lg bg-blue-50 p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[9px] font-semibold text-white">
                        {initialsOf(item.respondedBy?.name || "JHA")}
                      </span>
                      <p className="text-xs font-medium text-blue-900">
                        {item.respondedBy?.name || "JHA Company"} replied
                      </p>
                      {item.respondedAt && (
                        <span className="text-[11px] text-blue-700/70">
                          · {fmt(item.respondedAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-blue-900">{item.response}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] italic text-slate-400">
                    Waiting for the team to respond.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title="Share your feedback"
        subtitle="Honest ratings help us fix the right things"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Send feedback
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Alert>{formError}</Alert>

          <Field label="How would you rate us?" required>
            <StarPicker
              value={Number(form.rating)}
              onChange={(rating) => setForm((prev) => ({ ...prev, rating }))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Project" hint="Leave blank for general feedback">
              <Select
                name="project"
                value={form.project}
                onChange={change}
                placeholder="General feedback"
                options={lookups.projectOptions}
              />
            </Field>

            <Field label="What is this about?">
              <Select
                name="category"
                value={form.category}
                onChange={change}
                options={CATEGORIES.map((c) => ({ value: c, label: prettify(c) }))}
              />
            </Field>
          </div>

          <Field label="Anything you want to add?">
            <Textarea
              name="message"
              value={form.message}
              onChange={change}
              rows={4}
              placeholder="The site team has been responsive and the weekly updates are useful."
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
