import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  IdCard,
  Landmark,
  Save,
  UserRound,
} from "lucide-react";

import { useRecordForm } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";
import LoginCredentials from "../../components/LoginCredentials";
import DocumentUpload from "../../components/DocumentUpload";
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

const EMPTY = {
  name: "",
  email: "",
  password: "",
  phone: "",
  designation: "",
  department: "",
  joiningDate: "",
  status: "active",
  reportsTo: "",

  documents: { aadhaarNumber: "", panNumber: "" },
  bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "", upi: "" },
  previousEmployment: { companyName: "", designation: "", lastSalary: "", from: "", to: "" },
};

/** The files this form can carry, in the order the steps ask for them. */
const IDENTITY_FILES = ["aadhaarFront", "aadhaarBack", "panFront", "panBack"];
const EMPLOYMENT_FILES = ["experienceLetter", "salarySlip", "relievingLetter"];

const NO_FILES = [...IDENTITY_FILES, ...EMPLOYMENT_FILES].reduce(
  (acc, name) => ({ ...acc, [name]: null }),
  {}
);

const STEPS = [
  { title: "Basic details", subtitle: "Who they are and how they sign in", icon: UserRound },
  { title: "Documents", subtitle: "Aadhaar and PAN, front and back", icon: IdCard },
  { title: "Bank details", subtitle: "Where salary is paid", icon: Landmark },
  { title: "Previous company", subtitle: "Optional — leave blank for a fresher", icon: Building2 },
];

/* ------------------------------------------------------------- validation */

const AADHAAR = /^\d{12}$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;

const digits = (value) => String(value || "").replace(/[\s-]/g, "");

/**
 * What each step refuses to move past. The same rules the server applies, run
 * here as well so a missing PAN is caught while the admin is still looking at
 * the PAN field, rather than four steps later.
 *
 * `strict` is false when editing. Records created before any of this existed
 * have no documents on file, and a form that would not let their phone number
 * be corrected until somebody photographed a five-year-old PAN card would be
 * the wrong way round — the server takes the same position.
 */
const validateStep = (step, form, files, strict) => {
  const problems = {};

  if (step === 0) {
    if (!form.name.trim()) problems.name = "Enter their full name";
    if (!form.email.trim()) problems.email = "Enter their email — it is the login ID";
    if (!form.phone.trim()) problems.phone = "Enter a mobile number";
  }

  if (step === 1) {
    const aadhaar = digits(form.documents.aadhaarNumber);
    const pan = form.documents.panNumber.trim().toUpperCase();

    if (aadhaar ? !AADHAAR.test(aadhaar) : strict) {
      problems.aadhaarNumber = aadhaar ? "An Aadhaar number is 12 digits" : "Enter the Aadhaar number";
    }
    if (pan ? !PAN.test(pan) : strict) {
      problems.panNumber = pan ? "A PAN looks like ABCDE1234F" : "Enter the PAN number";
    }
    if (strict) {
      IDENTITY_FILES.forEach((name) => {
        if (!files[name] && !form[fileSection(name)]?.[name]?.storedName) {
          problems[name] = "Required";
        }
      });
    }
  }

  if (step === 2) {
    const account = digits(form.bank.accountNumber);
    const ifsc = form.bank.ifsc.trim().toUpperCase();

    if (strict && !form.bank.accountName.trim()) {
      problems.accountName = "Enter the name on the account";
    }
    if (account ? !ACCOUNT.test(account) : strict) {
      problems.accountNumber = account ? "An account number is 9 to 18 digits" : "Enter the account number";
    }
    if (ifsc ? !IFSC.test(ifsc) : strict) {
      problems.ifsc = ifsc ? "An IFSC looks like HDFC0001234" : "Enter the IFSC code";
    }
  }

  // Step 4 has nothing to refuse. Somebody joining from their first job has
  // none of it, and chasing a relieving letter must not hold up their login.

  return problems;
};

/** Which sub-document a file belongs to, for reading what is already stored. */
const fileSection = (name) =>
  IDENTITY_FILES.includes(name) ? "documents" : "previousEmployment";

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/**
 * Add or edit a team leader or an employee, in four steps.
 *
 * One form for both, as it always was: the two roles differ by which endpoint
 * it posts to and whether it asks who they report to, and nothing else. The
 * paperwork is identical, so splitting it in two would only guarantee the
 * halves drifted apart.
 *
 * The steps exist because the page had grown past what anybody reads: identity
 * documents, bank details and a previous employer are three separate
 * conversations, usually with three different pieces of paper in hand. Only
 * the last step is optional, and it says so on its own tab rather than leaving
 * the admin to find out by pressing Save.
 *
 * Nothing is written until the final step. There is no half-created employee
 * to clean up if somebody closes the tab at step three.
 */
export default function StaffForm({ resource, title, listPath, showTeamLeader }) {
  const navigate = useNavigate();
  const lookups = useLookups();

  const { form, setForm, change, submit, id, isEdit, loading, saving, error, success } =
    useRecordForm(resource, EMPTY, (item) => ({
      ...item,
      password: "",
      joiningDate: toDateInput(item.joiningDate),
      reportsTo: item.reportsTo?._id || "",
      documents: { ...EMPTY.documents, ...(item.documents || {}) },
      bank: { ...EMPTY.bank, ...(item.bank || {}) },
      previousEmployment: {
        ...EMPTY.previousEmployment,
        ...(item.previousEmployment || {}),
        from: toDateInput(item.previousEmployment?.from),
        to: toDateInput(item.previousEmployment?.to),
      },
    }));

  const [step, setStep] = useState(0);
  const [files, setFiles] = useState(NO_FILES);
  const [problems, setProblems] = useState({});

  // On an edit, everything the record already has is valid by definition —
  // see validateStep
  const strict = !isEdit;

  /** One field inside one of the three sub-documents. */
  const changeIn = (section) => (e) =>
    setForm((prev) => ({
      ...prev,
      [section]: { ...prev[section], [e.target.name]: e.target.value },
    }));

  const pickFile = (name, file) => {
    setFiles((prev) => ({ ...prev, [name]: file }));
    setProblems((prev) => ({ ...prev, [name]: undefined }));
  };

  const goTo = (next) => {
    setProblems({});
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = () => {
    const found = validateStep(step, form, files, strict);
    if (Object.keys(found).length) return setProblems(found);
    goTo(step + 1);
  };

  /**
   * Every step is checked, not just the one on screen. The stepper lets an
   * admin jump back and forth, so "I am standing on the last step" is not the
   * same as "the three behind me are still filled in".
   */
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Enter inside a text field should move the form on, not save three steps
    // early with half of it blank
    if (step < STEPS.length - 1) return next();

    for (let i = 0; i < STEPS.length; i += 1) {
      const found = validateStep(i, form, files, strict);
      if (Object.keys(found).length) {
        setStep(i);
        setProblems(found);
        return;
      }
    }

    /**
     * Multipart, because of the scans. The three sub-documents travel as JSON
     * strings beside the files — a FormData is flat, and the server would
     * otherwise receive "documents[aadhaarNumber]" style keys it would have to
     * reassemble.
     */
    const body = new FormData();

    const basics = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      designation: form.designation,
      department: form.department,
      status: form.status,
    };
    if (form.password) basics.password = form.password;
    if (form.joiningDate) basics.joiningDate = form.joiningDate;
    if (showTeamLeader && form.reportsTo) basics.reportsTo = form.reportsTo;

    Object.entries(basics).forEach(([key, value]) => body.append(key, value ?? ""));

    body.append("documents", JSON.stringify(form.documents));
    body.append("bank", JSON.stringify(form.bank));
    body.append("previousEmployment", JSON.stringify(form.previousEmployment));

    Object.entries(files).forEach(([name, file]) => file && body.append(name, file));

    const ok = await submit(body);
    if (!ok) return;

    if (isEdit) {
      setTimeout(() => navigate(listPath), 700);
      return;
    }

    // A fresh create leaves a blank form — which has to include the files and
    // the step, or the next person starts on step four holding the last
    // person's Aadhaar card
    setFiles(NO_FILES);
    setProblems({});
    goTo(0);
  };

  if (loading) return <Loader />;

  const last = step === STEPS.length - 1;
  const Icon = STEPS[step].icon;

  return (
    <div>
      <PageHeader
        title={isEdit ? `Edit ${title}` : `Add ${title}`}
        subtitle={
          isEdit
            ? "Update details, documents, bank and reporting line"
            : "Four steps — their mobile number becomes the login password"
        }
      >
        <Button variant="outline" onClick={() => navigate(listPath)}>
          <ArrowLeft size={15} />
          Back
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <Stepper
          step={step}
          // Jumping ahead is only safe once the way there has been walked: on
          // an edit everything is already filled in, on a create it is not
          furthest={isEdit ? STEPS.length - 1 : step}
          onGo={goTo}
        />

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Icon size={16} className="text-blue-600" />
                {STEPS[step].title}
              </span>
            }
            subtitle={STEPS[step].subtitle}
          />

          <div className="p-5">
            <Alert>{error}</Alert>
            <Alert tone="success">{success}</Alert>

            {step === 0 && (
              <BasicStep
                form={form}
                change={change}
                problems={problems}
                lookups={lookups}
                showTeamLeader={showTeamLeader}
                isEdit={isEdit}
                title={title}
              />
            )}

            {step === 1 && (
              <DocumentsStep
                form={form}
                changeIn={changeIn}
                files={files}
                pickFile={pickFile}
                problems={problems}
                strict={strict}
                recordId={id}
                resource={resource}
              />
            )}

            {step === 2 && <BankStep form={form} changeIn={changeIn} problems={problems} strict={strict} />}

            {step === 3 && (
              <PreviousStep
                form={form}
                changeIn={changeIn}
                files={files}
                pickFile={pickFile}
                recordId={id}
                resource={resource}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => (step === 0 ? navigate(listPath) : goTo(step - 1))}
            >
              <ArrowLeft size={15} />
              {step === 0 ? "Cancel" : "Back"}
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                Step {step + 1} of {STEPS.length}
              </span>

              {last ? (
                <Button type="submit" loading={saving}>
                  <Save size={15} />
                  {isEdit ? "Save changes" : `Create ${title.toLowerCase()}`}
                </Button>
              ) : (
                <Button type="button" onClick={next}>
                  Next
                  <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- stepper */

function Stepper({ step, furthest, onGo }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-2">
      {STEPS.map((item, index) => {
        const done = index < step;
        const here = index === step;
        const reachable = index <= furthest;

        return (
          <li key={item.title} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onGo(index)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                here
                  ? "bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-200"
                  : reachable
                    ? "text-slate-600 hover:bg-slate-50"
                    : "cursor-not-allowed text-slate-300"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? "bg-blue-600 text-white"
                    : here
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {done ? <Check size={13} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{item.title}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ steps */

function BasicStep({ form, change, problems, lookups, showTeamLeader, isEdit, title }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required hint={problems.name}>
          <Input name="name" value={form.name} onChange={change} placeholder="Arjun Kapoor" />
        </Field>

        <Field label="Email" required hint={problems.email}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={change}
            placeholder="arjun@jha.com"
          />
        </Field>

        <Field
          label="Mobile number"
          required
          hint={problems.phone || "This becomes the login password"}
        >
          <Input name="phone" value={form.phone} onChange={change} placeholder="98765 43210" />
        </Field>

        <Field label="Designation">
          <Input
            name="designation"
            value={form.designation}
            onChange={change}
            placeholder="Site Engineer"
          />
        </Field>

        <Field label="Department">
          <Select
            name="department"
            value={form.department}
            onChange={change}
            placeholder="Select department"
            options={["Execution", "Design", "Operations", "Accounts", "Admin"]}
          />
        </Field>

        <Field label="Joining date">
          <Input name="joiningDate" type="date" value={form.joiningDate} onChange={change} />
        </Field>

        <Field label="Status">
          <Select
            name="status"
            value={form.status}
            onChange={change}
            options={["active", "inactive"]}
          />
        </Field>

        {showTeamLeader && (
          <Field label="Reports to" className="sm:col-span-2">
            <Select
              name="reportsTo"
              value={form.reportsTo}
              onChange={change}
              placeholder="No team leader"
              options={lookups.leaderOptions}
            />
          </Field>
        )}
      </div>

      <LoginCredentials
        email={form.email}
        phone={form.phone}
        password={form.password}
        onPasswordChange={change}
        isEdit={isEdit}
        roleLabel={title.toLowerCase()}
      />
    </>
  );
}

function DocumentsStep({
  form,
  changeIn,
  files,
  pickFile,
  problems,
  strict,
  recordId,
  resource,
}) {
  const change = changeIn("documents");

  const shared = { files, pickFile, problems, recordId, resource, stored: form.documents };

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Aadhaar number" required={strict} hint={problems.aadhaarNumber}>
          <Input
            name="aadhaarNumber"
            value={form.documents.aadhaarNumber}
            onChange={change}
            inputMode="numeric"
            maxLength={14}
            placeholder="1234 5678 9012"
          />
        </Field>

        <Field label="PAN number" required={strict} hint={problems.panNumber}>
          <Input
            name="panNumber"
            value={form.documents.panNumber}
            onChange={change}
            maxLength={10}
            placeholder="ABCDE1234F"
            className="uppercase"
          />
        </Field>
      </div>

      <Slot {...shared} name="aadhaarFront" label="Aadhaar — front" required={strict} />
      <Slot {...shared} name="aadhaarBack" label="Aadhaar — back" required={strict} />
      <Slot {...shared} name="panFront" label="PAN — front" required={strict} />
      <Slot {...shared} name="panBack" label="PAN — back" required={strict} />
    </div>
  );
}

function BankStep({ form, changeIn, problems, strict }) {
  const change = changeIn("bank");

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Name on the account"
        required={strict}
        hint={problems.accountName || "As printed in the passbook"}
        className="sm:col-span-2"
      >
        <Input
          name="accountName"
          value={form.bank.accountName}
          onChange={change}
          placeholder="Arjun Kapoor"
        />
      </Field>

      <Field label="Account number" required={strict} hint={problems.accountNumber}>
        <Input
          name="accountNumber"
          value={form.bank.accountNumber}
          onChange={change}
          inputMode="numeric"
          placeholder="123456789012"
        />
      </Field>

      <Field label="IFSC code" required={strict} hint={problems.ifsc}>
        <Input
          name="ifsc"
          value={form.bank.ifsc}
          onChange={change}
          maxLength={11}
          placeholder="HDFC0001234"
          className="uppercase"
        />
      </Field>

      <Field label="Bank name">
        <Input name="bankName" value={form.bank.bankName} onChange={change} placeholder="HDFC Bank" />
      </Field>

      <Field label="Branch">
        <Input name="branch" value={form.bank.branch} onChange={change} placeholder="Andheri East" />
      </Field>

      <Field label="UPI ID" hint="Optional — for small reimbursements" className="sm:col-span-2">
        <Input name="upi" value={form.bank.upi} onChange={change} placeholder="arjun@okhdfcbank" />
      </Field>
    </div>
  );
}

function PreviousStep({ form, changeIn, files, pickFile, recordId, resource }) {
  const change = changeIn("previousEmployment");
  const shared = { files, pickFile, problems: {}, recordId, resource, stored: form.previousEmployment };

  return (
    <div className="grid gap-5">
      <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
        All of this is optional. Leave it blank for a fresher, or fill it in later once the
        paperwork from their last employer arrives.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <Input
            name="companyName"
            value={form.previousEmployment.companyName}
            onChange={change}
            placeholder="Larsen & Toubro"
          />
        </Field>

        <Field label="Designation there">
          <Input
            name="designation"
            value={form.previousEmployment.designation}
            onChange={change}
            placeholder="Junior Engineer"
          />
        </Field>

        <Field label="Last drawn salary" hint="Monthly, in rupees">
          <Input
            name="lastSalary"
            value={form.previousEmployment.lastSalary}
            onChange={change}
            placeholder="35000"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Input
              name="from"
              type="date"
              value={form.previousEmployment.from}
              onChange={change}
            />
          </Field>
          <Field label="To">
            <Input name="to" type="date" value={form.previousEmployment.to} onChange={change} />
          </Field>
        </div>
      </div>

      <Slot {...shared} name="experienceLetter" label="Experience letter" />
      <Slot {...shared} name="salarySlip" label="Salary slip" />
      <Slot {...shared} name="relievingLetter" label="Relieving letter" />
    </div>
  );
}

/** One document slot, wired to the form's file state. */
function Slot({ name, label, required, files, pickFile, problems, stored, recordId, resource }) {
  return (
    <DocumentUpload
      name={name}
      label={label}
      required={required}
      file={files[name]}
      stored={stored?.[name]}
      recordId={recordId}
      resource={resource}
      onPick={pickFile}
      error={problems[name]}
    />
  );
}
