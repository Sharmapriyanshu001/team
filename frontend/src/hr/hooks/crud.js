import { makeCrudHooks } from "../../shared/hooks/crud";
import hrApi from "../hrApi";

/** The same list and form hooks the other panels use, pointed at /api/hr. */
export const { useCrud, useRecordForm } = makeCrudHooks(hrApi, "/hr");
