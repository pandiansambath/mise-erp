"use client";

// What being unverified actually costs, said plainly, on every page.
//
//   "instead of this we need to make loose — let them enter, then verify the
//    mail id. if they not verified mail id then don't allow them to use forget
//    password or alerts, these are all paused until email id is verified, ELSE
//    IT WILL CREATE CONFUSION."
//
// That last clause is the whole reason this component exists. Loosening the
// gate without saying anything just moves the confusion: someone gets in, uses
// the app for a week, then finds "forgot password" silently does nothing on the
// day they actually need it. A pause nobody was told about is worse than a wall
// they understood.
//
// So it is quiet but permanent — one line, no dismiss button — and it names the
// two things that are switched off rather than nagging in the abstract.

import { useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function VerifyBanner() {
  const { user } = useAuth();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // `email_verified` is optional on the type and defaults to true on the
  // server, so only an explicit false means "not yet" — an older token that
  // predates the field must not light this up.
  if (!user || user.email_verified !== false) return null;

  return (
    <div
      role="status"
      data-testid="verify-banner"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-2.5 text-sm"
    >
      <span aria-hidden>✉️</span>
      <span className="min-w-0 flex-1 text-fg-soft">
        <b className="text-fg">Confirm {user.email}</b> to switch on password
        reset and email alerts — both are paused until you do. Everything else works.
      </span>
      <button
        type="button"
        disabled={busy || sent}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post("/auth/resend-verification", { email: user.email });
            setSent(true);
          } catch {
            // The endpoint always answers OK by design, so there is nothing
            // useful to report here beyond "we tried".
            setSent(true);
          } finally {
            setBusy(false);
          }
        }}
        className="mise-btn-flat mise-press min-h-[36px] shrink-0 px-3 py-1.5 text-xs font-medium text-fg-soft disabled:opacity-60"
      >
        {sent ? "Link sent ✓" : busy ? "Sending…" : "Resend the link"}
      </button>
    </div>
  );
}
