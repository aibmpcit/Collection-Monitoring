import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to login");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="grid w-full max-w-6xl gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="panel relative hidden overflow-hidden p-8 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute right-[-64px] top-[-70px] h-48 w-48 rounded-full bg-c2/25 blur-3xl" />
          <div className="absolute bottom-[-48px] left-[-56px] h-44 w-44 rounded-full bg-orange-300/20 blur-3xl" />

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-c2/30 bg-c2/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-c2">
              <Sparkles size={14} />
              Operations Console
            </span>
            <h1 className="mt-4 max-w-lg text-4xl font-bold leading-tight text-slate-900">
              Modern command center for branch collections.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-slate-700/90">
              Monitor overdue risk, staff activity, payment movements, and portfolio exposure through one fast, role-aware workspace.
            </p>
          </div>

          <div className="relative grid gap-3">
            <article className="surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Action-ready dashboards</p>
              <p className="mt-1 text-sm text-slate-700">Spot high-risk accounts early and prioritize collection follow-ups quickly.</p>
            </article>
            <article className="surface-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Role-based control</p>
              <p className="mt-1 text-sm text-slate-700">Super admin, branch admin, and staff access stays segmented and secure.</p>
            </article>
          </div>
        </section>

        <motion.form
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="panel w-full max-w-md justify-self-center p-6 sm:p-7"
          onSubmit={handleSubmit}
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-c2/15 p-2 text-c2">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-700/80">Secure sign-in for admin and staff</p>
            </div>
          </div>

          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Username
            <input className="field" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>

          <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
            Password
            <div className="relative">
              <input
                className="field pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-700"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <button type="submit" className="btn-primary mt-5 w-full gap-2">
            Sign In
            <ArrowRight size={16} />
          </button>

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </motion.form>
      </div>
    </main>
  );
}
