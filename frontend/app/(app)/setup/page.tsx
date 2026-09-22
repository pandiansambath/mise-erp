"use client";

/** /setup is now /onboarding.
 *
 *  A REDIRECT RATHER THAN A DELETION, deliberately. Several places send
 *  people here — `lib/auth.tsx` on sign-in and on signup, the dashboard
 *  card, and the verify-email link that lands a minute after an email goes
 *  out. That last one is why this file survives: a link already sitting in
 *  somebody's inbox cannot be updated, and a 404 at the end of a welcome
 *  email is the worst possible first impression of a product whose whole
 *  problem was first impressions.
 *
 *  The call sites are updated too; this catches what they miss and whatever
 *  is already in the wild.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Spinner } from "@/components/ui";

export default function SetupMoved() {
  const router = useRouter();

  useEffect(() => {
    // `replace`, not `push`: the back button should take him where he came
    // from rather than bouncing him through this page again.
    router.replace("/onboarding");
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center py-20">
      <Spinner />
      <span className="sr-only">Taking you to setup…</span>
    </div>
  );
}
