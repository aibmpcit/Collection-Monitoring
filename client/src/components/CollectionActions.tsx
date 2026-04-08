import { BellRing, CircleCheck, PlusCircle } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "../services/api";

interface CollectionActionsProps {
  loanId: number;
  onPenaltyUpdated: () => Promise<void>;
}

export function CollectionActions({ loanId, onPenaltyUpdated }: CollectionActionsProps) {
  const [penalty, setPenalty] = useState("0");
  const [message, setMessage] = useState("");
  const [template, setTemplate] = useState("");

  async function addPenalty() {
    await apiRequest(`/loans/${loanId}/penalty`, "PATCH", { penalty: Number(penalty) });
    setMessage("Penalty updated.");
    await onPenaltyUpdated();
  }

  async function draftReminder() {
    const response = await apiRequest<{ draft: string }>(`/collections/${loanId}/draft`, "POST");
    setTemplate(response.draft);
  }

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Collection Actions</h2>
        <span className="glass-pill">Loan #{loanId}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="field max-w-[180px]"
          type="number"
          min="0"
          value={penalty}
          onChange={(event) => setPenalty(event.target.value)}
          aria-label="Penalty amount"
        />
        <button className="btn-primary gap-2" onClick={addPenalty}>
          <PlusCircle size={16} />
          Apply Penalty
        </button>
        <button className="btn-muted gap-2" onClick={draftReminder}>
          <BellRing size={16} />
          Draft Reminder
        </button>
      </div>
      {message && (
        <p className="mt-3 inline-flex items-center gap-1 text-sm text-emerald-700">
          <CircleCheck size={14} />
          {message}
        </p>
      )}
      {template && (
        <div className="surface-soft mt-3 p-3">
          <h3 className="text-sm font-semibold text-slate-800">Reminder Draft</h3>
          <p className="mt-1 text-sm text-slate-700">{template}</p>
        </div>
      )}
    </section>
  );
}
