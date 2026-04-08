import { motion } from "framer-motion";
import { Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { PageHeader } from "../components/PageHeader";
import { apiRequest } from "../services/api";

interface AnalyticsPayload {
  overdueRate: number;
  collectionEfficiency: number;
  activeLoans: number;
}

export function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setError("");
      try {
        const payload = await apiRequest<AnalyticsPayload>("/analytics/overview");
        if (!active) return;
        setAnalytics(payload);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Unable to load analytics.");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const cards = useMemo(
    () => [
      {
        icon: <AlertTriangle size={18} />,
        label: "Overdue Rate",
        value: analytics ? `${analytics.overdueRate.toFixed(2)}%` : "-",
        hint: "Accounts overdue against total active portfolio."
      },
      {
        icon: <TrendingUp size={18} />,
        label: "Collection Efficiency",
        value: analytics ? `${analytics.collectionEfficiency.toFixed(2)}%` : "-",
        hint: "Collected amount versus due amount for current cycle."
      },
      {
        icon: <Activity size={18} />,
        label: "Active Loans",
        value: analytics ? analytics.activeLoans.toLocaleString() : "-",
        hint: "Open active contracts currently being monitored."
      }
    ],
    [analytics]
  );

  return (
    <main className="page-shell">
      <PageHeader
        title="Analytics"
        subtitle="Monitor portfolio health with core risk and performance indicators."
        eyebrow="Performance Signals"
        actions={<PageMetaStamp />}
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="metric-grid">
        {cards.map((card, index) => (
          <motion.article
            key={card.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: index * 0.04 }}
            className="panel relative overflow-hidden p-4"
          >
            <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-c2/20 blur-2xl" />
            <div className="relative flex items-center gap-2 text-c2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/80 bg-white/70">
                {card.icon}
              </span>
              <p className="text-sm font-semibold text-slate-700">{card.label}</p>
            </div>
            <h2 className="relative mt-3 text-3xl font-bold text-slate-900">{card.value}</h2>
            <p className="relative mt-2 text-xs text-slate-600">{card.hint}</p>
          </motion.article>
        ))}
      </section>
    </main>
  );
}
