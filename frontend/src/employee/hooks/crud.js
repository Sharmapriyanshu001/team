import { makeCrudHooks } from "../../shared/hooks/crud";
import employeeApi from "../employeeApi";

// Employee panel bindings for the shared list/form hooks.
export const { useCrud, useRecordForm } = makeCrudHooks(employeeApi, "/employee");
