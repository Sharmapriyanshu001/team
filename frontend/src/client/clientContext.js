import { createContext, useContext } from "react";

export const ClientContext = createContext(null);

/** Session state for the client portal — see ClientProvider. */
export const useClient = () => useContext(ClientContext);
