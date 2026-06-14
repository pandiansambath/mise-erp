"use client";

// Landing entry point. Picks the experience and gets out of the way:
//   • logged-in visitors → straight to the dashboard
//   • capable browsers (WebGL + motion allowed) → the immersive 3D journey
//   • everyone else (no WebGL / reduced-motion / a WebGL crash) → the classic
//     polished landing page, which stays as a always-works fallback.

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import ClassicLanding from "@/components/landing/ClassicLanding";

// three.js can't run on the server — load the journey only in the browser.
const JourneyExperience = dynamic(() => import("@/components/journey/JourneyExperience"), {
  ssr: false,
  loading: () => <DarkSplash />,
});

function DarkSplash() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1026]">
      <div className="flex flex-col items-center">
        <Logo size={48} />
        <p className="mt-4 font-display text-3xl text-white">Mise</p>
      </div>
    </div>
  );
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/** If the 3D journey ever throws at runtime, fall back to the classic page
    instead of showing a blank canvas. */
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
    setMode(!reduced && hasWebGL() ? "journey" : "classic");
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1026]">
        <Spinner />
      </div>
    );
  }

  if (mode === "pending") return <DarkSplash />;
  if (mode === "classic") return <ClassicLanding />;
  return (
    <JourneyBoundary>
      <JourneyExperience />
    </JourneyBoundary>
  );
}
