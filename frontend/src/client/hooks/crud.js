import { makeCrudHooks } from "../../shared/hooks/crud";
import clientApi from "../clientApi";

// Client portal bindings for the shared list/form hooks.
export const { useCrud, useRecordForm } = makeCrudHooks(clientApi, "/client");
