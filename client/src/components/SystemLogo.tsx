/** The app's own mark: a check over rising bars, drawn to match the BMPC Hometel icon. */
export function SystemLogo({ className = "h-12 w-12" }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Collection Monitoring logo"
    width={64} height={64} className={`shrink-0 rounded-xl object-contain ${className}`} />;
}
