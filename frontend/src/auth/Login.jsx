import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Building2,
  Eye,
  EyeOff,
  FolderKanban,
  ShieldCheck,
  Users,
} from "lucide-react";

import api from "../api";
import { clearAllSessions, currentSession, storeSession } from "./session";

/**
 * The one login page.
 *
 * Six panels each had their own — /admin/login, /hr/login, /sales/login and so
 * on — which meant somebody had to know which of six addresses was theirs
 * before they could type a password, and getting it wrong told them their
 * perfectly good credentials were refused. Now everybody starts at "/" and the
 * server works out where they belong.
 *
 * WHERE SOMEBODY GOES IS NOT DECIDED HERE
 *
 * The response carries the path, the token key and the user key. This page
 * stores what it is told and navigates where it is told. A panel added or a
 * role remapped on the server needs no change in this file — and, more to the
 * point, the login cannot send anybody somewhere the middleware would then
 * refuse, because both answers come from the same map. See
 * backend/utils/panels.js.
 */

const HIGHLIGHTS = [
  { icon: FolderKanban, text: "Every project, task and deadline in one place" },
  { icon: Users, text: "Your team, your clients and what they are waiting on" },
  { icon: ShieldCheck, text: "You only ever see the panel your role is for" },
];

export default function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * Somebody who is already signed in should not be shown a login form.
   *
   * Checked during render rather than in an effect so the form never flashes
   * on screen before the redirect. Only when exactly ONE panel has a session —
   * two at once is a deliberate thing somebody did, and they get to choose.
   */
  const [dismissed, setDismissed] = useState(false);
  const live = dismissed ? null : currentSession();
  if (live) return <Navigate to={live.path} replace />;

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", form);
      storeSession(data);
      navigate(data.path, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Could not sign you in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ------------------------------------------------------ brand panel */}
      <div className="relative hidden flex-col justify-between bg-[#0B0F1A] p-12 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Building2 size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-white">JHA Company</p>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Sign in</p>
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-bold leading-tight text-white">
            One sign in.
            <br />
            Your own panel.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            Admin, HR, Sales, Operations, employees and clients all start here. We take you to the
            right place.
          </p>

          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-blue-400">
                  <Icon size={16} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-600">© {new Date().getFullYear()} JHA Company</p>
      </div>

      {/* ------------------------------------------------------- the form */}
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Building2 size={20} />
            </span>
            <div className="leading-tight">
              <p className="font-semibold text-slate-900">JHA Company</p>
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Sign in</p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Use the account your administrator set up for you.
          </p>

          {error && (
            <div className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100">
              {error}
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={form.email}
                onChange={change}
                placeholder="you@jha.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={change}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-400">
            Accounts are created by your administrator — there is no self sign-up. Lost your
            password? Ask them to reset it.
          </p>

          {/**
           * The escape hatch for a browser holding several sessions at once.
           * Rare, but without it somebody signed in as two people can be bounced
           * to a panel they did not want and have no way back to this form.
           */}
          {!dismissed && (
            <button
              type="button"
              onClick={() => {
                clearAllSessions();
                setDismissed(true);
              }}
              className="mt-3 w-full text-center text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
            >
              Signed in as somebody else? Sign out of everything
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
