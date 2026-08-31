import axios from "axios";

import { closeSocket } from "./realtime";

/**
 * One axios instance per panel. Each panel keeps its own token in localStorage
 * so an admin and a team leader can be signed in side by side without one
 * session clobbering the other.
 */
/**
 * Clear one panel's session. The live socket carries that panel's token, so it
 * has to go with it — otherwise a signed-out tab keeps receiving messages.
 */
export const signOut = (tokenKey, userKey) => {
  closeSocket(tokenKey);
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
};

export const createApi = ({ tokenKey, userKey, loginPath }) => {
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

  return api;
};

export const readStoredUser = (userKey) => {
  try {
    return JSON.parse(localStorage.getItem(userKey) || "null");
  } catch {
    return null;
  }
};
