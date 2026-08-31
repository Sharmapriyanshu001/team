import { makeCrudHooks } from "../../shared/hooks/crud";
import adminApi from "../adminApi";

// Admin panel bindings for the shared list/form hooks.
export const { useCrud, useRecordForm } = makeCrudHooks(adminApi, "/admin");
