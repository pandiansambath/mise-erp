"use client";

// Landing entry point. Picks the experience and gets out of the way:
//   • logged-in visitors → straight to the dashboard
//   • motion-OK visitors → the premium landing (cinema hero + live dashboard
//     simulation + one-shot AI morph films)
//   • reduced-motion visitors (or a runtime error) → the classic polished
//     landing page, which stays as an always-works fallback.

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import ClassicLanding from "@/components/landing/ClassicLanding";

// The premium landing. Browser-only (scroll-driven, IntersectionObserver).
const PremiumLanding = dynamic(() => import("@/components/landing/premium/PremiumLanding"), {
  ssr: false,
  loading: () => <DarkSplash />,
});

function DarkSplash() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#04080e]">
      <div className="flex flex-col items-center">
        <Logo size={48} />
        <p className="mt-4 font-display text-3xl text-white">Mise</p>
      </div>
    </div>
  );
}

/** If the premium landing ever throws at runtime, fall back to the classic
    page instead of showing a blank screen. */
class JourneyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ClassicLanding /> : this.props.children;
  }
}

type Mode = "pending" | "journey" | "classic";

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("pending");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMode(reduced ? "classic" : "journey");
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#04080e]">
        <Spinner />
      </div>
    );
  }

  if (mode === "pending") return <DarkSplash />;
  if (mode === "classic") return <ClassicLanding />;
  return (
    <JourneyBoundary>
      <PremiumLanding />
    </JourneyBoundary>
  );
}
