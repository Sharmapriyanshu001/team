import SharedStaffForm from "../../../shared/staff/StaffForm";
import { useRecordForm } from "../../hooks/crud";
import useLookups from "../../hooks/useLookups";

/**
 * The admin panel's copy of the staff form — which is the shared one, wired
 * to this panel's API and its lookups.
 *
 * The form itself moved to shared/staff/StaffForm.jsx when HR stopped having
 * a shorter form of its own. Everything that used to import this file still
 * does, and still gets the same screen: only the two things that differ per
 * panel are supplied here.
 */
export default function StaffForm(props) {
  const lookups = useLookups();

  return (
    <SharedStaffForm
      {...props}
      useRecordForm={useRecordForm}
      reportsToOptions={lookups.leaderOptions}
    />
  );
}
