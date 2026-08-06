"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ConfirmProvider } from "@/components/confirm";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    // Platform operators live in the standalone Control Room, not a hotel's app.
    else if (user.is_platform_owner) router.replace("/control-room");
    // The attendance tablet has one screen. It is a shared device in a public
    // part of the restaurant, so it must never render the app around it even
    // for the instant before the API refuses.
    else if (user.role === "KIOSK") router.replace("/kiosk");
  }, [user, loading, router]);

  if (loading || !user || user.is_platform_owner) {
    return (
      <div className="grid min-h-screen place-items-center bg-shell">
        <Spinner />
      </div>
    );
  }

  return (
    <ConfirmProvider>
      <AppShell>{children}</AppShell>
    </ConfirmProvider>
  );
}
