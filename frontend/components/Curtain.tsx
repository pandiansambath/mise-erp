"use client";

// Full-screen "plating cloche" sweep used when crossing the auth boundary
// (login/signup → dashboard). The auth context fires `mise:transition` just
// before it routes; whichever page is showing renders this over everything,
// the new page then glides in underneath (app/(app)/template.tsx).
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

export function useCurtain(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onGo = () => setShow(true);
    window.addEventListener("mise:transition", onGo);
    return () => window.removeEventListener("mise:transition", onGo);
  }, []);
  return show;
}

export function Curtain({ show, label = "Plating up…" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div aria-hidden className="mise-curtain">
      <div className="mise-curtain-content flex flex-col items-center gap-3">
        <Logo size={48} />
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-brand-300/90">{label}</p>
      </div>
    </div>
  );
}
