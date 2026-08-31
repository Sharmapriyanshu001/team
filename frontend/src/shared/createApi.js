import axios from "axios";

import { closeSocket } from "./realtime";

/**
 * One axios instance per panel. Each panel keeps its own token in localStorage
 * so an admin and a team leader can be signed in side by side without one
 * session clobbering the other.
 */
/**
 * Every panel that has been created, by token key. Lets signOut() reach the
 * right server without each of its eight callers having to pass the api in.
 */
const panels = new Map();

/**
 * Clear one panel's session. The live socket carries that panel's token, so it
 * has to go with it — otherwise a signed-out tab keeps receiving messages.
 *
 * The server is told first. Clearing localStorage only ends the session on
 * this machine; the token stays valid for the rest of its seven days wherever
 * else it exists until the server bumps the account's token version.
 *
 * Deliberately not awaited. The person has asked to leave and the UI should
 * let them — a slow or failed request must not hold them on a page they have
 * finished with. The worst case is the token living out its week, which is
 * exactly what happened before this call existed.
 */
export const signOut = (tokenKey, userKey) => {
  const panel = panels.get(tokenKey);
  if (panel && localStorage.getItem(tokenKey)) {
    panel.api.post(panel.logoutPath).catch(() => {});
  }

  closeSocket(tokenKey);
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
};

/**
 * Replace the stored token without disturbing anything else about the session.
 *
 * Changing a password bumps the account's token version, which is what signs
 * the other devices out. This is how the device that did the changing gets to
 * stay — the server hands back a freshly minted token and it is saved here.
 */
export const saveToken = (tokenKey, token) => {
  if (token) localStorage.setItem(tokenKey, token);
};

export const createApi = ({ tokenKey, userKey, loginPath, logoutPath }) => {
  const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
    headers: { "Content-Type": "application/json" },
  });

  api.interceptors.request.use((config) => {
    const token = localStorage.getItem(tokenKey);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  // Only a broken session sends the user back to the login. A plain 403 —
  // "that project is not yours", "client chat is turned off" — is a normal
  // answer the page should render, not a reason to sign anyone out.
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error.response?.status;
      const sessionProblem = status === 401 || error.response?.data?.code === "AUTH";

      if (sessionProblem) {
        signOut(tokenKey, userKey);
        if (!window.location.pathname.startsWith(loginPath)) {
          window.location.href = loginPath;
        }
      }
      return Promise.reject(error);
    }
  );

  if (logoutPath) panels.set(tokenKey, { api, logoutPath });

  return api;
};

export const readStoredUser = (userKey) => {
  try {
    return JSON.parse(localStorage.getItem(userKey) || "null");
  } catch {
    return null;
  }
};
