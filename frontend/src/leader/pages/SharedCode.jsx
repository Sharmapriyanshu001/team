import leaderApi from "../leaderApi";
import { useCrud } from "../hooks/crud";
import SharedCodeList from "../../shared/components/SharedCodeList";

/**
 * Leading a project does not grant access to its code — only what the admin
 * shared explicitly shows up here.
 */
export default function SharedCode() {
  return (
    <SharedCodeList
      useCrud={useCrud}
      resource="code"
      api={leaderApi}
      base="/leader"
      subtitle="Code the admin has shared with you"
    />
  );
}
