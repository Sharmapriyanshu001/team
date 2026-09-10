import { useEffect, useState } from "react";
import { Banknote, Briefcase, IdCard } from "lucide-react";

import hrApi from "../hrApi";
import DocumentUpload from "../../admin/components/DocumentUpload";
import Modal from "../../shared/components/Modal";
import { Alert, Button, Field, Input, Loader } from "../../shared/components/ui";

/**
 * Somebody's onboarding file, filled in from the Documents screen.
 *
 * Three sections, because they are asked for at three different moments and by
 * three different people: the identity cards on the first day, the bank
 * account before the first payroll, and the previous employer's letters
 * whenever they finally turn up. A person can be saved with any one of them
 * filled and the other two empty, which is the ordinary case.
 *
 * Everything is merged onto what is already stored rather than replacing it —
 * see applyStaffPaperwork on the server. Filling in a bank account weeks after
 * the Aadhaar photo was uploaded does not take the photo off the record.
 */

const BLANK = {
  documents: { aadhaarNumber: "", panNumber: "" },
  bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "", upi: "" },
  previousEmployment: {
    companyName: "",
    designation: "",
    lastSalary: "",
    from: "",
    to: "",
  },
};

const IDENTITY_FILES = [
  ["aadhaarFront", "Aadhaar — front"],
  ["aadhaarBack", "Aadhaar — back"],
  ["panFront", "PAN — front"],
  ["panBack", "PAN — back"],
  // Filed here rather than under previous employment: a fresher has a CV and
  // no previous employer — see the note on the model.
  ["resume", "CV / Resume"],
];

const EMPLOYMENT_FILES = [
  ["experienceLetter", "Experience letter"],
  ["salarySlip", "Salary slip"],
  ["relievingLetter", "Relieving letter"],
];

const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/** Where a stored scan is fetched from in this panel. */
const docPath = (id, field) => `/hr/documents/${id}/${field}`;

const Section = ({ icon: Icon, title, hint, children }) => (
  <div className="rounded-lg border border-slate-200 p-4">
    <div className="mb-3 flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon size={14} />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
    </div>
    {children}
  </div>
);

export default function PaperworkModal({ person, onClose, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [files, setFiles] = useState({});
  const [stored, setStored] = useState({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * The record is fetched when the panel opens rather than taken from the
   * table row, because the Documents list deliberately does not carry
   * everybody's Aadhaar number and bank account — see the register endpoint.
   */
  useEffect(() => {
    if (!person) return undefined;

    let active = true;
    setLoading(true);
    setError("");
    setFiles({});

    hrApi
      .get(`/hr/employees/${person._id}/details`)
      .then(({ data }) => {
        if (!active) return;
        const item = data.item || {};

        setForm({
          documents: {
            aadhaarNumber: item.documents?.aadhaarNumber || "",
            panNumber: item.documents?.panNumber || "",
          },
          bank: {
            accountName: item.bank?.accountName || "",
            accountNumber: item.bank?.accountNumber || "",
            ifsc: item.bank?.ifsc || "",
            bankName: item.bank?.bankName || "",
            branch: item.bank?.branch || "",
            upi: item.bank?.upi || "",
          },
          previousEmployment: {
            companyName: item.previousEmployment?.companyName || "",
            designation: item.previousEmployment?.designation || "",
            lastSalary: item.previousEmployment?.lastSalary || "",
            from: dateInput(item.previousEmployment?.from),
            to: dateInput(item.previousEmployment?.to),
          },
        });

        // What is already on the server, so each slot can say "on file"
        setStored({
          ...(item.documents || {}),
          ...(item.previousEmployment || {}),
        });
      })
      .catch((err) => active && setError(err.response?.data?.message || "Could not load this record"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [person]);

  const set = (section, key, value) =>
    setForm((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      /**
       * A FormData is flat, so the three sections travel as JSON strings
       * beside the files — the server parses them back. Same shape the admin
       * panel's staff form uses, which is why one handler serves both.
       */
      const body = new FormData();
      body.append("documents", JSON.stringify(form.documents));
      body.append("bank", JSON.stringify(form.bank));
      body.append("previousEmployment", JSON.stringify(form.previousEmployment));

      Object.entries(files).forEach(([name, file]) => file && body.append(name, file));

      await hrApi.put(`/hr/employees/${person._id}/documents`, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save these details");
    } finally {
      setSaving(false);
    }
  };

  const pick = (name, file) => setFiles((current) => ({ ...current, [name]: file }));

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      title={person ? `Details for ${person.name}` : ""}
      subtitle="Identity, bank and previous employment — fill in whatever you have; the rest can follow"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={loading}>
            Save details
          </Button>
        </>
      }
    >
      {loading ? (
        <Loader label="Loading their record…" />
      ) : (
        <form onSubmit={save} className="space-y-4">
          <Alert>{error}</Alert>

          {/* ------------------------------------------------------ identity */}
          <Section
            icon={IdCard}
            title="Identity"
            hint="Numbers as printed on the card — they are checked for shape, not reformatted"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Aadhaar number">
                <Input
                  value={form.documents.aadhaarNumber}
                  onChange={(e) => set("documents", "aadhaarNumber", e.target.value)}
                  placeholder="1234 5678 9012"
                  inputMode="numeric"
                />
              </Field>
              <Field label="PAN number">
                <Input
                  value={form.documents.panNumber}
                  onChange={(e) => set("documents", "panNumber", e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {IDENTITY_FILES.map(([name, label]) => (
                <DocumentUpload
                  key={name}
                  name={name}
                  label={label}
                  file={files[name]}
                  stored={stored[name]}
                  recordId={person?._id}
                  api={hrApi}
                  docPath={docPath}
                  onPick={pick}
                />
              ))}
            </div>
          </Section>

          {/* ---------------------------------------------------------- bank */}
          <Section icon={Banknote} title="Bank" hint="Where salary goes">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Account holder">
                <Input
                  value={form.bank.accountName}
                  onChange={(e) => set("bank", "accountName", e.target.value)}
                />
              </Field>
              <Field label="Account number">
                <Input
                  value={form.bank.accountNumber}
                  onChange={(e) => set("bank", "accountNumber", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="IFSC">
                <Input
                  value={form.bank.ifsc}
                  onChange={(e) => set("bank", "ifsc", e.target.value.toUpperCase())}
                  placeholder="HDFC0001234"
                />
              </Field>
              <Field label="Bank">
                <Input
                  value={form.bank.bankName}
                  onChange={(e) => set("bank", "bankName", e.target.value)}
                />
              </Field>
              <Field label="Branch">
                <Input
                  value={form.bank.branch}
                  onChange={(e) => set("bank", "branch", e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="UPI" hint="Optional">
                <Input
                  value={form.bank.upi}
                  onChange={(e) => set("bank", "upi", e.target.value)}
                  placeholder="name@bank"
                />
              </Field>
            </div>
          </Section>

          {/* ------------------------------------------------- previous work */}
          <Section
            icon={Briefcase}
            title="Previous employment"
            hint="Leave empty for a fresher — the letters often turn up weeks later"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company">
                <Input
                  value={form.previousEmployment.companyName}
                  onChange={(e) => set("previousEmployment", "companyName", e.target.value)}
                />
              </Field>
              <Field label="Designation">
                <Input
                  value={form.previousEmployment.designation}
                  onChange={(e) => set("previousEmployment", "designation", e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Last salary">
                <Input
                  value={form.previousEmployment.lastSalary}
                  onChange={(e) => set("previousEmployment", "lastSalary", e.target.value)}
                  placeholder="45,000"
                />
              </Field>
              <Field label="From">
                <Input
                  type="date"
                  value={form.previousEmployment.from}
                  onChange={(e) => set("previousEmployment", "from", e.target.value)}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={form.previousEmployment.to}
                  onChange={(e) => set("previousEmployment", "to", e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {EMPLOYMENT_FILES.map(([name, label]) => (
                <DocumentUpload
                  key={name}
                  name={name}
                  label={label}
                  file={files[name]}
                  stored={stored[name]}
                  recordId={person?._id}
                  api={hrApi}
                  docPath={docPath}
                  onPick={pick}
                />
              ))}
            </div>
          </Section>
        </form>
      )}
    </Modal>
  );
}
