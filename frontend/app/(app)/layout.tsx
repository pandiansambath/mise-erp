"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ConfirmProvider } from "@/components/confirm";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // CARRY THE DESTINATION. This used to be a bare replace("/login"), so
      // wherever they were trying to reach was thrown away and sign-in always
      // landed on /dashboard. Password-reset and document-request links arrive
      // by EMAIL, so the person following one is exactly the person least
      // likely to be signed in already.
      // window.location, NOT useSearchParams().
      //
      // useSearchParams() opts the whole route out of prerendering unless it
      // is wrapped in <Suspense>, and it broke the build here: "Error occurred
      // prerendering page /my". This runs in an effect, which is client-only
      // by definition, so the query string is simply there to be read.
      const here = pathname + (typeof window !== "undefined" ? window.location.search : "");
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
    // Platform operators live in the standalone Control Room, not a hotel's app.
    else if (user.is_platform_owner) router.replace("/control-room");
    // The attendance tablet has one screen. It is a shared device in a public
    // part of the restaurant, so it must never render the app around it even
    // for the instant before the API refuses.
    else if (user.role === "KIOSK") router.replace("/kiosk");
  }, [user, loading, router, pathname]);

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
