import { Coins, Landmark, ReceiptText, WalletCards } from "lucide-react";

interface DuesCardProps {
  principal: number;
  interest: number;
  penalty: number;
}

export function DuesCard({ principal, interest, penalty }: DuesCardProps) {
  const total = principal + interest + penalty;

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<Landmark size={16} />} label="Principal" value={principal} />
      <Metric icon={<Coins size={16} />} label="Interest" value={interest} />
      <Metric icon={<ReceiptText size={16} />} label="Penalty" value={penalty} />
      <Metric icon={<WalletCards size={16} />} label="Total Outstanding" value={total} emphasis />
    </section>
  );
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function Metric({
  icon,
  label,
  value,
  emphasis = false
}: {
  icon: JSX.Element;
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <article className={`panel relative overflow-hidden p-4 ${emphasis ? "border-c4/35" : ""}`}>
      <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-c2/12 blur-2xl" />
      <div className={`relative flex items-center gap-2 ${emphasis ? "text-c4" : "text-c2"}`}>
        {icon}
        <p className="text-sm font-semibold text-slate-700">{label}</p>
      </div>
      <h3 className="relative mt-2 text-xl font-bold text-slate-900">{pesoFormatter.format(value)}</h3>
    </article>
  );
}
