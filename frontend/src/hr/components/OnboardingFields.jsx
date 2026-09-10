import { IdCard, Landmark } from "lucide-react";

import hrApi from "../hrApi";
import DocumentUpload from "../../admin/components/DocumentUpload";
import { Field, Input } from "../../shared/components/ui";

/**
 * The onboarding pack: the two identity cards, and where the salary goes.
 *
 * The same questions on every HR form that opens an account, in one place.
 * They were written out twice already — once on the Managers screen and once
 * on Operations Managers — and a third copy on Employees is how the three
 * quietly stop asking for the same things.
 *
 * The scans travel as files beside the two sub-documents, which go as JSON
 * strings; see how the callers build their FormData. Nothing here knows how it
 * is sent, only what is asked. What makes the pack complete lives in
 * ./onboarding.js, so a caller can check it without importing a form.
 */

export default function OnboardingFields({ form, changeIn, files, pickFile, problems = {} }) {
  const scan = (name, label) => (
    <DocumentUpload
      name={name}
      label={label}
      file={files[name]}
      onPick={(picked) => pickFile(name, picked)}
      api={hrApi}
    />
  );

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <IdCard size={15} /> Identity
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Aadhaar number" required hint={problems.aadhaarNumber}>
          <Input
            name="aadhaarNumber"
            value={form.documents.aadhaarNumber}
            onChange={changeIn("documents")}
            inputMode="numeric"
            maxLength={14}
            placeholder="1234 5678 9012"
          />
        </Field>
        <Field label="PAN number" required hint={problems.panNumber}>
          <Input
            name="panNumber"
            value={form.documents.panNumber}
            onChange={changeIn("documents")}
            maxLength={10}
            placeholder="ABCDE1234F"
            className="uppercase"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {scan("aadhaarFront", "Aadhaar — front")}
        {scan("aadhaarBack", "Aadhaar — back")}
        {scan("panFront", "PAN — front")}
        {scan("panBack", "PAN — back")}
        {/* Filed with the identity papers: a fresher has a CV and no last employer */}
        {scan("resume", "CV / Resume")}
      </div>

      <p className="text-[11px] text-slate-400">
        The scans can follow later — open the person's record to add them when the paperwork
        arrives.
      </p>

      <p className="flex items-center gap-2 pt-1 text-sm font-medium text-slate-900">
        <Landmark size={15} /> Bank
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name on the account" required hint={problems.accountName}>
          <Input
            name="accountName"
            value={form.bank.accountName}
            onChange={changeIn("bank")}
            placeholder="As printed in the passbook"
          />
        </Field>
        <Field label="Bank">
          <Input
            name="bankName"
            value={form.bank.bankName}
            onChange={changeIn("bank")}
            placeholder="HDFC Bank"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account number" required hint={problems.accountNumber}>
          <Input
            name="accountNumber"
            value={form.bank.accountNumber}
            onChange={changeIn("bank")}
            inputMode="numeric"
            placeholder="123456789012"
          />
        </Field>
        <Field label="IFSC code" required hint={problems.ifsc}>
          <Input
            name="ifsc"
            value={form.bank.ifsc}
            onChange={changeIn("bank")}
            maxLength={11}
            placeholder="HDFC0001234"
            className="uppercase"
          />
        </Field>
      </div>
    </div>
  );
}
