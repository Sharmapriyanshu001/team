import { createContext, useContext } from "react";

export const EmployeeContext = createContext(null);

/** Session state for the employee panel — see EmployeeProvider. */
export const useEmployee = () => useContext(EmployeeContext);
