import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TrendingDown } from "lucide-react";

import adminApi from "../../adminApi";
import Modal from "../../../shared/components/Modal";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Loader,
  PageHeader,
  Select,
} from "../../../shared/components/ui";
import { PROPERTY_KINDS, PROPERTY_STATUS, money, signedMoney } from "./constants";

const localDate = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const firstOfMonth = () => {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
};

const BLANK = { name: "", kind: "android_app", handle: "", url: "", status: "live" };

function Tile({ label, value, sub, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-green-700",
    red: "text-red-600",
    amber: "text-amber-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className={`text-xl font-semibold leading-none tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function Portfolio() {
  const navigate = useNavigate();

  const [range, setRange] = useState({ from: firstOfMonth(), to: localDate(new Date()) });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const changeRange = useCallback((patch) => {
    setLoading(true);
    setRange((current) => ({ ...current, ...patch }));
  }, []);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    adminApi
      .get("/admin/portfolio", { params: range })
      .then(({ data: payload }) => {
        if (!active) return;
        setData(payload);
        setError("");
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Could not load the portfolio");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [range, reloadKey]);

  const create = async () => {
    setSaving(true);
    setFormError("");
    try {
      const { data: created } = await adminApi.post("/admin/portfolio/properties", form);
      setAdding(false);
      setForm(BLANK);
      navigate(`/admin/portfolio/${created.item._id}`);
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not add that");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Loader label="Adding up…" />;

  const totals = data?.totals;

  return (
    <div>
      <PageHeader
        title="Our Portfolio"
        subtitle="Apps and sites we own — what each one earns, costs, and owes"
      >
        <Button onClick={() => setAdding(true)}>
          <Plus size={15} />
          Add property
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => changeRange({ from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={range.to}
            onChange={(e) => changeRange({ to: e.target.value })}
          />
        </Field>
        <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Refresh
        </Button>
      </div>

      <Alert>{error}</Alert>

      {totals && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Earned" value={money(totals.revenue)} sub="in this period" />
          <Tile
            label="Actually received"
            value={money(totals.received)}
            sub={totals.pending ? `${money(totals.pending)} still to come` : "all in"}
            tone="green"
          />
          <Tile label="Spent" value={money(totals.expenses)} />
          <Tile
            label="Profit"
            value={signedMoney(totals.profit)}
            tone={totals.profit >= 0 ? "green" : "red"}
          />
          <Tile
            label="Owed to partners"
            value={money(totals.owedToPartners)}
            sub={`we keep ${money(totals.studioTake)}`}
            tone={totals.owedToPartners > 0 ? "amber" : "slate"}
          />
        </div>
      )}

      {data?.losing?.length > 0 && (
        <Card className="mb-4 border-red-200 bg-red-50/50">
          <div className="px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-red-900">
              <TrendingDown size={15} />
              Losing money this period
            </p>
            <ul className="mt-2 space-y-1 text-xs text-red-800">
              {data.losing.map((row) => (
                <li key={row._id}>
                  <span className="font-medium">{row.name}</span> — made {money(row.revenue)}, spent{" "}
                  {money(row.expenses)}, down {money(Math.abs(row.profit))}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Every property" subtitle="Click one to see its books" />

        {!data?.properties?.length ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nothing here yet. Add an app or a site you own.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Property</th>
                  <th className="px-4 py-2.5 text-right">Earned</th>
                  <th className="px-4 py-2.5 text-right">Received</th>
                  <th className="px-4 py-2.5 text-right">Ad spend</th>
                  <th className="px-4 py-2.5 text-right">All costs</th>
                  <th className="px-4 py-2.5 text-right">Profit</th>
                  <th className="px-4 py-2.5 text-right">Margin</th>
                  <th className="px-4 py-2.5 text-right">Partners owed</th>
                </tr>
              </thead>
              <tbody>
                {data.properties.map((row) => (
                  <tr
                    key={row._id}
                    onClick={() => navigate(`/admin/portfolio/${row._id}`)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="text-xs text-slate-400">
                        {row.handle || row.kind.replace(/_/g, " ")}
                        {row.partnerCount > 0 &&
                          ` · ${row.partnerCount} partner${row.partnerCount === 1 ? "" : "s"}`}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                      {money(row.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {money(row.received)}
                      {row.pending > 0 && (
                        <span className="block text-[11px] text-amber-600">
                          {money(row.pending)} due
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {money(row.adSpend)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {money(row.expenses)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                        row.profit >= 0 ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {signedMoney(row.profit)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {row.margin === null ? "—" : `${row.margin}%`}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {row.owedToPartners > 0 ? money(row.owedToPartners) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={adding}
        title="Add a property"
        subtitle="Something we own — not a client's project"
        size="sm"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving} disabled={!form.name.trim()}>
              Add
            </Button>
          </>
        }
      >
        <Alert>{formError}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Daily Quiz"
            />
          </Field>
          <Field label="What is it">
            <Select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              options={PROPERTY_KINDS}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={PROPERTY_STATUS}
            />
          </Field>
          <Field
            label="Package name or domain"
            className="sm:col-span-2"
            hint="com.studio.quiz, or dailyquiz.in"
          >
            <Input
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              className="font-mono"
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Partners, ad accounts and the Play link are set up on the property&apos;s own page.
        </p>
      </Modal>
    </div>
  );
}
