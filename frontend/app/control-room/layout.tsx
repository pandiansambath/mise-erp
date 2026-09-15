"use client";

// Standalone shell for the DineAI OPERATOR area, deliberately SEPARATE from
// any hotel's app (no hotel sidebar). An operator logs in with the platform
// credential and lands straight here to manage every hotel on DineAI.
//
// THIS FILE OWNS, and nothing under it repeats: the guard (once — this stays
// mounted across every sibling navigation), the header + live status strip +
// the area's ONE clock, the `mise-cr-grid` backdrop, OperatorNav, FleetProvider,
// ConfirmProvider, and the Ask dock (OperatorAI as a slide-over — a
// cross-cutting tool, not a destination with its own URL).
//
// The old shell was `<main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">`
// — max-w-7xl is 1280px, so on his 1920 screen that threw away 624px (32.5%)
// as dead margin down each side. This is the complaint he has made most
// often, and it is the one thing this file exists to fix: no cap, a rail
// instead of empty space.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmProvider } from "@/components/confirm";
import { Logo } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/AppShell";
import { Drawer, Spinner } from "@/components/ui";
import { OperatorAI } from "@/components/OperatorAI";
import { useAuth } from "@/lib/auth";
import { THEMES, themeVars, useTheme } from "@/lib/theme";
import { FleetProvider, useFleet } from "@/components/controlroom/FleetProvider";
import { OperatorNav } from "@/components/controlroom/OperatorNav";

/** Header + rail + main. A child of FleetProvider so the live counts in the
 *  header and the hotel count on the rail read the SAME fetch as every page
 *  underneath — never a second, possibly-different, /platform/hotels call. */
function ConsoleBody({ children, email, logout }: { children: React.ReactNode; email: string; logout: () => void }) {
  const { hotels, loading: fleetLoading, error: fleetError } = useFleet();
  const [utc, setUtc] = useState("");
  const [askOpen, setAskOpen] = useState(false);

  // The area's ONE clock (rubric E5) — nothing else in the Control Room may
  // render a second one.
  useEffect(() => {
    const tick = () => setUtc(new Date().toISOString().slice(11, 19));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const active = hotels.filter((h) => h.is_active).length;
  const suspended = hotels.length - active;
  const fleetKnown = !fleetLoading && !fleetError;

  return (
    <>
      {/* ONE ROW, <=60px at 390 (rubric E1) — "DineAI" drops below `sm` so
          "Control Room" stays legible instead of the whole string
          truncating; "Log out" never breaks to "Log / out" (E2). */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-glass/10 bg-shell/70 px-4 py-3 backdrop-blur-xl lg:px-6">
        <Logo size={24} />
        <span className="min-w-0 truncate font-display text-base font-semibold tracking-tight text-fg sm:text-lg">
          <span className="hidden sm:inline">DineAI </span>
          <span className="text-brand-400">Control Room</span>
        </span>
        {/* `.mise-chip` sets `display: inline-flex` unconditionally and,
            being plain CSS rather than a layered utility, otherwise beats
            `hidden` at the cascade level regardless of breakpoint — the
            `!` modifier is the one way a utility outranks it. */}
        <span className="mise-chip !hidden shrink-0 sm:!inline-flex" data-tone="slate">
          Operator
        </span>

        <span className="flex-1" />

        {/* The console strip's job, done here instead of as a second bar
            floating a clock 900px from the numbers it belongs beside
            (rubric B3) — one cluster, tight gaps, hidden below `lg` so the
            mobile header stays one line. */}
        {fleetKnown && (
          <span className="hidden shrink-0 items-center gap-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-fg-faint lg:inline-flex">
            <span>fleet {hotels.length}</span>
            <span className="text-brand-300">{active} up</span>
            {suspended > 0 && <span className="text-rose-300">{suspended} suspended</span>}
            <span className="tabular-nums">{utc} UTC</span>
          </span>
        )}

        <span className="hidden shrink-0 truncate text-sm text-fg-faint md:inline">{email}</span>

        <button
          type="button"
          onClick={() => setAskOpen(true)}
          className="mise-btn-flat mise-press shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-fg-soft"
        >
          Ask
        </button>
        <ThemeSwitcher />
        <button
          onClick={logout}
          className="mise-press shrink-0 whitespace-nowrap rounded-lg border border-glass/15 px-3 py-1.5 text-sm font-medium text-fg-soft transition hover:bg-glass/5"
        >
          Log out
        </button>
      </header>

      <ConfirmProvider>
        <div className="mise-cr-grid flex min-h-[calc(100vh-57px)] flex-col gap-4 px-4 py-4 lg:flex-row lg:gap-5 lg:px-6 lg:py-5">
          <OperatorNav />
          {/* A COLUMN, so a page can choose to fill the height.
              The shell was already `min-h-[calc(100vh-57px)]`, so on a
              fleet of three hotels the cards floated at the top of a tall
              container and left six hundred pixels of bare ground beneath
              them. Empty space INSIDE a card is normal; empty space
              outside one reads as a component that failed to load — which
              is the complaint he has made more than any other. */}
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </ConfirmProvider>

      <Drawer open={askOpen} onClose={() => setAskOpen(false)} title="Operator assistant" wide>
        <OperatorAI />
      </Drawer>
    </>
  );
}

export default function ControlRoomLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!user.is_platform_owner) router.replace("/dashboard"); // not an operator → back to app
  }, [user, loading, router]);

  const themed = { ...themeVars(theme), colorScheme: THEMES[theme].light ? "light" : ("dark" as const) };

  if (loading || !user || !user.is_platform_owner) {
    return (
      <div className="mise-app grid min-h-screen place-items-center bg-shell text-fg" style={themed}>
        <Spinner />
      </div>
    );
  }

  return (
    <div
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={themed}
      className="mise-app min-h-screen bg-shell text-fg"
    >
      <FleetProvider>
        <ConsoleBody email={user.email} logout={logout}>
          {children}
        </ConsoleBody>
      </FleetProvider>
    </div>
  );
}
