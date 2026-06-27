import { Logo } from "@/components/Logo";

/** The one Mise lockup — emerald mark + wordmark — used on every page (landing,
 * auth, onboarding, app) so the brand never diverges. */
export function Brand({
  size = 28,
  wordmark = true,
  className = "",
  wordClassName = "",
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo size={size} />
      {wordmark && (
        <span className={`font-display font-semibold tracking-tight ${wordClassName}`}>Mise</span>
      )}
    </span>
  );
}
