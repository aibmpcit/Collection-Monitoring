export function SystemLogo({ className = "h-12 w-12" }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="Cooperative logo"
    width={64} height={64} className={`shrink-0 rounded-xl bg-white object-contain ${className}`} />;
}
