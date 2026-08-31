import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, UserRound, ListChecks, ClipboardList, CalendarDays } from "lucide-react";
import api from "../api";

const HIGHLIGHTS = [
  { icon: ListChecks, text: "Everything assigned to you, in one list" },
  { icon: ClipboardList, text: "Log your daily work and flag blockers" },
  { icon: CalendarDays, text: "Deadlines and project milestones at a glance" },
];

export default function EmployeeLogin() {
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
      const { data } = await api.post("/employee/login", form);
      localStorage.setItem("employeeToken", data.token);
      localStorage.setItem("employee", JSON.stringify(data.employee));
      navigate("/employee/dashboard");
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
            <UserRound size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-white">JHA Company</p>
            <p className="text-[11px] uppercase tracking-widest text-slate-500">Workspace</p>
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-bold leading-tight text-white">
            Your work,
            <br />
            without the chasing.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            See what's due, move it along, and submit it for review — all from one place.
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
              <UserRound size={20} />
            </span>
            <div className="leading-tight">
              <p className="font-semibold text-slate-900">JHA Company</p>
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Workspace</p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Employee sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the account your admin set up for you</p>

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
            Accounts are created by the administrator — there is no self sign-up. Lost your
            password? Ask your admin to reset it.
          </p>
        </div>
      </div>
    </div>
  );
}
