import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Handshake, Target, PhoneCall, TrendingUp } from "lucide-react";

import api from "../api";
import { forgetSalesAccess } from "./hooks/useSalesAccess";

const HIGHLIGHTS = [
  { icon: Target, text: "Every lead, from the first call to the signature" },
  { icon: PhoneCall, text: "Follow-ups that come back to you on the day" },
  { icon: TrendingUp, text: "The pipeline, and why the lost ones were lost" },
];

export default function SalesLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/sales/login", form);
      localStorage.setItem("salesToken", data.token);
      localStorage.setItem("sales", JSON.stringify(data.sales));
      // The previous account's access must not survive into this session
      forgetSalesAccess();
      navigate("/sales/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong");
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
            <Handshake size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-white">JHA Company</p>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Sales Panel</p>
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-bold leading-tight text-white">
            Nothing goes cold
            <br />
            because nobody called.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            The pipeline, the promises and the paperwork — in the order you actually work through
            them.
          </p>

          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-blue-500">
                  <Icon size={16} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-slate-600">© {new Date().getFullYear()} JHA Company</p>
      </div>

      {/* ------------------------------------------------------- login form */}
      <div className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Handshake size={20} />
            </span>
            <div className="leading-tight">
              <p className="font-semibold text-slate-900">JHA Company</p>
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Sales Panel</p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            For the Sales head and the executives they set up
          </p>

          {error && (
            <div className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                autoComplete="username"
                placeholder="you@jha.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Password</label>
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
            The Sales head&apos;s account is created by the administrator; executives are created by
            the Sales head. There is no self sign-up.
          </p>
        </div>
      </div>
    </div>
  );
}
