import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, TrendingUp, TriangleAlert, WalletMinimal } from "lucide-react";

import { useCrud } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import adminApi from "../../adminApi";
import DataTable from "../../../shared/components/DataTable";
import Toolbar from "../../../shared/components/Toolbar";
import Modal, { ConfirmDialog } from "../../../shared/components/Modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Select,
  Textarea,
} from "../../../shared/components/ui";
import {
  AD_ACCOUNT_STATUS,
  AD_PLATFORMS,
  FEE_TYPES,
  FUNDING_MODES,
  rupees,
} from "./constants";

const BLANK = {
  name: "",
  platform: "meta",
  externalId: "",
  client: "",
  status: "active",
  currency: "INR",
  funding: "client_card",
  monthlyBudget: "",
  feeType: "percent_of_spend",
  feeValue: "",
  notes: "",
  teamLeaders: [],
  employees: [],
};

/**
 * How the month is going, as a bar.
 *
 * A single hue that fills as the budget is used, turning amber past three
 * quarters and red past all of it — status colour, and never on its own: the
 * number beside it says the same thing in words.
 */
function Pace({ pacing }) {
  if (!pacing) return <span className="text-xs text-slate-400">No budget set</span>;

  const over = pacing.spent > pacing.budget;
  const near = pacing.usedPercent >= 75;
  const width = Math.min(100, pacing.usedPercent);

  return (
    <div className="min-w-[8rem]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums text-slate-700">{rupees(pacing.spent)}</span>
        <span className="tabular-nums text-slate-400">of {rupees(pacing.budget)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          style={{ width: `${width}%` }}
          className={`h-full rounded-full ${
            over ? "bg-red-500" : near ? "bg-amber-500" : "bg-blue-600"
          }`}
        />
      </div>
      {pacing.variance > 0 ? (
        <p className="mt-1 text-[11px] font-medium text-red-600">
          On pace for {rupees(pacing.onPaceFor)} — {rupees(pacing.variance)} over
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">
          On pace for {rupees(pacing.onPaceFor)}
        </p>
      )}
    </div>
  );
}

/** What the money situation is, which depends entirely on who is paying. */
function Money({ money }) {
  if (!money) return null;

  if (money.kind === "recoverable") {
    return money.unrecovered > 0 ? (
      <span className="text-xs font-medium text-amber-700">
        {rupees(money.unrecovered)} to bill back
      </span>
    ) : (
      <span className="text-xs text-slate-400">All billed</span>
    );
  }

  if (money.kind === "balance") {
    return money.exhausted ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <WalletMinimal size={12} />
        Out of money ({rupees(money.balance)})
      </span>
    ) : (
      <span className="text-xs text-slate-600">{rupees(money.balance)} left</span>
    );
  }

  return <span className="text-xs text-slate-400">Their card</span>;
}

export default function Accounts() {
  const navigate = useNavigate();
  const crud = useCrud("ads/accounts");
  const lookups = useLookups();

  const [overview, setOverview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [target, setTarget] = useState(null);

  useEffect(() => {
    adminApi
      .get("/admin/ads/overview")
      .then(({ data }) => setOverview(data))
      .catch(() => setOverview(null));
  }, [crud.rows]);

  const byId = new Map((overview?.accounts || []).map((row) => [row._id, row]));

  const open = (row) => {
    setFormError("");
    setEditing(row || BLANK);
    setForm(
      row
        ? {
            ...BLANK,
            ...row,
            client: row.client?._id || "",
            monthlyBudget: row.monthlyBudget || "",
            feeValue: row.feeValue || "",
            teamLeaders: (row.teamLeaders || []).map((u) => u._id || u),
            employees: (row.employees || []).map((u) => u._id || u),
          }
        : BLANK
    );
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        ...form,
        monthlyBudget: Number(form.monthlyBudget) || 0,
        feeValue: Number(form.feeValue) || 0,
      };
      if (editing?._id) await crud.update(editing._id, payload);
      else await crud.create(payload);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not save this account");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Account",
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-400">
            {AD_PLATFORMS.find((p) => p.value === row.platform)?.label}
            {row.externalId && ` · ${row.externalId}`}
          </p>
        </div>
      ),
    },
    { key: "client", header: "Client", render: (row) => row.client?.name || "—" },
    {
      key: "funding",
      header: "Who pays",
      render: (row) => (
        <span className="text-xs text-slate-600">
          {FUNDING_MODES.find((f) => f.value === row.funding)?.label}
        </span>
      ),
    },
    {
      key: "pace",
      header: "This month",
      render: (row) => <Pace pacing={byId.get(row._id)?.pacing} />,
    },
    {
      key: "money",
      header: "Money",
      render: (row) => <Money money={byId.get(row._id)?.money} />,
    },
    { key: "status", header: "Status", render: (row) => <Badge value={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              open(row);
            }}
            title="Edit"
            className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTarget(row);
            }}
            title="Delete"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const alerts = overview?.alerts;

  return (
    <div>
      <PageHeader title="Ads" subtitle="Meta and Google accounts, what they are spending, and whose money it is">
        <Button onClick={() => open(null)}>
          <Plus size={15} />
          Add account
        </Button>
      </PageHeader>

      {overview && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xl font-semibold tabular-nums text-slate-900">
              {rupees(overview.totals.spendThisMonth)}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">Spent this month</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              across {overview.accounts.length} live account
              {overview.accounts.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xl font-semibold tabular-nums text-amber-700">
              {rupees(overview.totals.owedToStudio)}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">Fronted and not yet billed</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {alerts.awaitingRecovery} account{alerts.awaitingRecovery === 1 ? "" : "s"}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p
              className={`text-xl font-semibold tabular-nums ${
                alerts.overspending.length ? "text-red-600" : "text-slate-900"
              }`}
            >
              {alerts.overspending.length}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">On pace to overspend</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p
              className={`text-xl font-semibold tabular-nums ${
                alerts.outOfMoney.length ? "text-red-600" : "text-slate-900"
              }`}
            >
              {alerts.outOfMoney.length}
            </p>
            <p className="mt-1.5 text-xs text-slate-500">Out of prepaid balance</p>
          </div>
        </div>
      )}

      {alerts && (alerts.overspending.length > 0 || alerts.outOfMoney.length > 0) && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <div className="px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <TriangleAlert size={15} />
              Needs looking at today
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800">
              {alerts.outOfMoney.map((row) => (
                <li key={`dry-${row._id}`}>
                  <span className="font-medium">{row.name}</span> — the client&apos;s balance is
                  down to {rupees(row.balance)}
                </li>
              ))}
              {alerts.overspending.map((row) => (
                <li key={`over-${row._id}`}>
                  <span className="font-medium">{row.name}</span> — on pace to go{" "}
                  {rupees(row.over)} over budget
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <Alert>{crud.error}</Alert>

      <Card>
        <Toolbar
          search={crud.search}
          onSearch={crud.setSearch}
          searchPlaceholder="Search by name or account id"
          onFilter={crud.setFilter}
          filters={[
            { key: "platform", value: crud.filters.platform, placeholder: "Any platform", options: AD_PLATFORMS },
            { key: "funding", value: crud.filters.funding, placeholder: "Anyone's money", options: FUNDING_MODES },
            { key: "status", value: crud.filters.status, placeholder: "Any status", options: AD_ACCOUNT_STATUS },
          ]}
        />
        <DataTable
          columns={columns}
          rows={crud.rows}
          loading={crud.loading}
          page={crud.page}
          pages={crud.pages}
          total={crud.total}
          onPageChange={crud.setPage}
          onRowClick={(row) => navigate(`/admin/ads/${row._id}`)}
          emptyTitle="No ad accounts yet"
          emptyMessage="Add a Meta or Google account to track spend, pacing and what is owed."
        />
      </Card>

      <Modal
        open={Boolean(editing)}
        title={editing?._id ? editing.name : "Add ad account"}
        subtitle="Who pays decides what the app does with the spend — get that one right"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim() || !form.client}>
              Save
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Adverta — Meta"
            />
          </Field>
          <Field label="Platform">
            <Select
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
              options={AD_PLATFORMS}
            />
          </Field>
          <Field label="Client" required>
            <Select
              value={form.client}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
              options={lookups.clientOptions}
              placeholder="Pick a client"
            />
          </Field>
          <Field label="Account ID" hint="act_1234567890 or 123-456-7890">
            <Input
              value={form.externalId}
              onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              className="font-mono"
            />
          </Field>

          <Field
            label="Who pays for the ads"
            required
            hint={
              form.funding === "studio_card"
                ? "Spend becomes a debt to bill back, tracked per period"
                : form.funding === "prepaid"
                  ? "Top-ups are recorded and spend draws them down"
                  : "Nothing to recover — only the management fee is invoiced"
            }
            className="sm:col-span-2"
          >
            <Select
              value={form.funding}
              onChange={(e) => setForm((f) => ({ ...f, funding: e.target.value }))}
              options={FUNDING_MODES}
            />
          </Field>

          <Field label="Monthly budget" hint="What pacing is measured against. 0 = none set.">
            <Input
              type="number"
              min="0"
              value={form.monthlyBudget}
              onChange={(e) => setForm((f) => ({ ...f, monthlyBudget: e.target.value }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={AD_ACCOUNT_STATUS}
            />
          </Field>

          <Field label="Our fee">
            <Select
              value={form.feeType}
              onChange={(e) => setForm((f) => ({ ...f, feeType: e.target.value }))}
              options={FEE_TYPES}
            />
          </Field>
          <Field
            label={form.feeType === "percent_of_spend" ? "Percent of spend" : "Amount per month"}
          >
            <Input
              type="number"
              min="0"
              disabled={form.feeType === "none"}
              value={form.feeValue}
              onChange={(e) => setForm((f) => ({ ...f, feeValue: e.target.value }))}
              placeholder={form.feeType === "percent_of_spend" ? "15" : "10000"}
            />
          </Field>

          <Field label="Team leaders" className="sm:col-span-2">
            <MultiSelect
              options={lookups.leaderOptions}
              value={form.teamLeaders}
              onChange={(value) => setForm((f) => ({ ...f, teamLeaders: value }))}
              placeholder="Search team leaders…"
              emptyLabel="No team leaders on record"
            />
          </Field>
          <Field label="Who runs it" className="sm:col-span-2">
            <MultiSelect
              options={lookups.employeeOptions}
              value={form.employees}
              onChange={(value) => setForm((f) => ({ ...f, employees: value }))}
              placeholder="Search employees…"
              emptyLabel="No employees on record"
            />
          </Field>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>

          <p className="sm:col-span-2 text-[11px] text-slate-400">
            <TrendingUp size={11} className="mr-1 inline" />
            The login for this account belongs in the Vault, not here.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(target)}
        title="Delete this ad account?"
        message={`"${target?.name}" goes, and so does every campaign on it and all their spend history. Anything not yet billed back would be lost with it — pause the account instead if you may still need the record.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await crud.remove(target._id);
          setTarget(null);
        }}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
