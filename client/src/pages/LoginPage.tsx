import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { SystemLogo } from "../components/SystemLogo";
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
      <div className="w-full max-w-md">
        <motion.form
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="panel w-full p-6 sm:p-7"
          onSubmit={handleSubmit}
        >
          <div className="mb-6 flex items-center gap-3">
            <SystemLogo className="h-16 w-16" />
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
