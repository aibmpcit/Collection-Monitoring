import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, FileSpreadsheet, Loader2, Lock, MapPin, User, Users } from "lucide-react";
import { SystemLogo } from "../components/SystemLogo";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const HIGHLIGHTS = [
  { icon: Users, title: "Every branch in one place", text: "Weekly overdue lists, PAR ages and settled accounts per branch." },
  { icon: MapPin, title: "Proof from the field", text: "Payments and actions taken with photos and location." },
  { icon: FileSpreadsheet, title: "Ready-made reports", text: "Filter any list and export it to Excel or PDF." }
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await login(username.trim(), password);
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
      setPending(false);
    }
  }

  const year = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel: a header band on phones, the left half on desktop. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 pb-20 pt-10 text-white lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 lg:h-[28rem] lg:w-[28rem]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-secondary-500/25 blur-2xl lg:h-96 lg:w-96" />

        <div className="relative flex items-center gap-3 lg:gap-4">
          <SystemLogo className="h-12 w-12 p-1 shadow-lg ring-4 ring-white/15 lg:h-14 lg:w-14" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">BMPC</p>
            <p className="text-lg font-bold leading-tight lg:text-xl">Collection Monitoring</p>
          </div>
        </div>

        <div className="relative mt-8 hidden max-w-lg lg:block">
          <h1 className="text-4xl font-bold leading-tight xl:text-5xl">
            Track every overdue account, <span className="text-secondary-100">from office to field.</span>
          </h1>
          <ul className="mt-10 grid gap-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-white/75">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative hidden text-xs text-white/60 lg:block">© {year} BMPC · For authorized staff only</p>
      </section>

      {/* Sign-in form: overlaps the header band on phones, centered on desktop. */}
      <section className="relative -mt-12 px-4 pb-10 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:px-10 lg:py-12">
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-soft sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        >
          <h2 className="text-center text-2xl font-bold text-slate-900">Sign in</h2>

          <div className="mt-7 grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Username
              <div className="relative">
                <User size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="field h-12 pl-11 text-base sm:text-sm"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter your username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  required
                  disabled={pending}
                />
              </div>
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Password
              <div className="relative">
                <Lock size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="field h-12 pl-11 pr-12 text-base sm:text-sm"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                  onBlur={() => setCapsLock(false)}
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  disabled={pending}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {capsLock && <span className="text-xs font-medium text-secondary-700">Caps Lock is on.</span>}
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle size={18} aria-hidden="true" className="mt-px shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <button type="submit" className="btn-primary mt-6 h-12 w-full gap-2 text-base" disabled={pending}>
            {pending ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" />Signing in...</> : <>Sign In<ArrowRight size={18} aria-hidden="true" /></>}
          </button>

          <p className="mt-6 text-center text-xs text-slate-500">
            Forgot your password? Ask your branch admin or system administrator to reset it.
          </p>
        </motion.form>
        <p className="mt-8 text-center text-xs text-slate-400 lg:hidden">© {year} BMPC · For authorized staff only</p>
      </section>
    </main>
  );
}
