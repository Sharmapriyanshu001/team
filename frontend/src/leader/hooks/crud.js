import { makeCrudHooks } from "../../shared/hooks/crud";
import leaderApi from "../leaderApi";

// Operations Manager panel bindings for the shared list/form hooks.
export const { useCrud, useRecordForm } = makeCrudHooks(leaderApi, "/leader");
