import employeeApi from "../employeeApi";
import { useCrud } from "../hooks/crud";
import SharedCodeList from "../../shared/components/SharedCodeList";

export default function SharedCode() {
  return (
    <SharedCodeList
      useCrud={useCrud}
      resource="code/shared"
      api={employeeApi}
      base="/employee"
      subtitle="Approved code the admin has given you access to"
    />
  );
}
