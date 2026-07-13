"use client";

// Standalone shell for the 🛰️ Control Room — the Mise OPERATOR area, deliberately
// SEPARATE from any hotel's app (no hotel sidebar). An operator logs in with the
// platform credential and lands straight here to manage every hotel on Mise.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConfirmProvider } from "@/components/confirm";
import { Logo } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/AppShell";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { THEMES, themeVars, useTheme } from "@/lib/theme";

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
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-glass/10 bg-shell/70 px-4 py-3 backdrop-blur-xl lg:px-8">
        <Logo size={26} />
        <span className="font-display text-lg font-semibold tracking-tight text-fg">
          Mise <span className="text-brand-400">Control Room</span>
        </span>
        <span className="ml-3 hidden rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300 sm:inline">
          Operator
        </span>
        <span className="ml-auto hidden text-sm text-fg-faint md:inline">{user.email}</span>
        <ThemeSwitcher />
        <button
          onClick={logout}
          className="rounded-lg border border-glass/15 px-3 py-1.5 text-sm font-medium text-fg-soft transition hover:bg-glass/5"
        >
          Log out
        </button>
      </header>
      <ConfirmProvider>
        <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">{children}</main>
      </ConfirmProvider>
    </div>
  );
}
