import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import SharedStaffForm from "../../shared/staff/StaffForm";
import hrApi from "../hrApi";
import { useRecordForm } from "../hooks/crud";
import useLeaderOptions from "../hooks/useLeaderOptions";
import { Alert, Loader } from "../../shared/components/ui";

/**
 * Adding somebody to the directory, and hiring a candidate into it.
 *
 * One form for both, because they write the same record. The admin panel's
 * four-step staff form is the form — see shared/staff/StaffForm.jsx — and this
 * page is what points it at HR's API and, when there is a `?candidate=` on the
 * URL, at the hire route instead of the plain create.
 *
 * WHY HIRING GOES SOMEWHERE ELSE
 *
 * Hiring is not "create an employee". It also links the candidate to the new
 * account so time-to-hire and the source that produced them survive, copies
 * their CV onto the staff record, marks onboarding complete and closes the
 * vacancy once enough people have joined. All of that lives behind
 * /hr/candidates/:id/hire, so the form posts there and the four steps in front
 * of it stay exactly the four steps.
 */
export default function HrStaffForm() {
  const [params] = useSearchParams();
  const candidateId = params.get("candidate");

  const reportsToOptions = useLeaderOptions();

  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(Boolean(candidateId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!candidateId) return undefined;

    let active = true;

    hrApi
      .get(`/hr/candidates/${candidateId}`)
      .then(({ data }) => active && setCandidate(data.item || data))
      .catch(
        (err) => active && setError(err.response?.data?.message || "Could not open that candidate")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [candidateId]);

  if (loading) return <Loader label="Reading the application…" />;

  if (candidateId && !candidate) {
    return <Alert>{error || "That candidate was not found"}</Alert>;
  }

  /**
   * What the application already answered.
   *
   * The onboarding record wins where it has something: it is what was agreed
   * in the days between selecting somebody and their first morning, and the
   * application is what they wrote about themselves weeks earlier.
   */
  const onboarding = candidate?.onboarding || {};
  const prefill = candidate
    ? {
        name: candidate.name || "",
        email: candidate.email || "",
        phone: candidate.phone || "",
        designation: onboarding.designation || candidate.position || "",
        department: onboarding.department || candidate.department || "",
        address: candidate.address || "",
        reportsTo: onboarding.reportsTo?._id || onboarding.reportsTo || "",
        joiningDate: onboarding.joiningDate ? String(onboarding.joiningDate).slice(0, 10) : "",
      }
    : undefined;

  const hire = async (body) => {
    try {
      await hrApi.post(`/hr/candidates/${candidateId}/hire`, body);
      return true;
    } catch (err) {
      setError(err.response?.data?.message || "Could not hire this candidate");
      return false;
    }
  };

  return (
    <>
      {candidateId && error && <Alert>{error}</Alert>}

      <SharedStaffForm
        resource="employees"
        title="Employee"
        listPath={candidateId ? "/hr/hiring/candidates" : "/hr/people?type=employee"}
        showOperationsManager
        useRecordForm={useRecordForm}
        reportsToOptions={reportsToOptions}
        /* HR's update route strips the password out of every save — see
           controllers/hr/peopleController.js — so it is not offered on an edit */
        canSetPasswordOnEdit={false}
        {...(candidate
          ? {
              saveRecord: hire,
              prefill,
              heading: `Hire ${candidate.name}`,
              blurb:
                "Four steps — this creates their staff account and links it back to their application",
            }
          : {})}
      />
    </>
  );
}
