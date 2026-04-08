import { useAuth } from "../context/AuthContext";

export function PageMetaStamp() {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric"
  });

  return (
    <div className="w-full text-left leading-tight sm:w-auto sm:text-right">
      <p className="text-xs font-semibold text-slate-700">{today}</p>
      <p className="text-xs font-semibold text-slate-500">{user?.role ?? "-"}</p>
    </div>
  );
}
