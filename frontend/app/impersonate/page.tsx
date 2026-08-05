"use client";

// Landing pad for the Control Room's "View as hotel" (read-only support view).
// The 15-minute impersonation token arrives in the URL HASH (never sent to the
// server or logged), gets stored, and we drop straight onto the dashboard.
// AppShell spots the `imp` claim and shows the purple read-only banner.

import { useEffect, useState } from "react";

export default function ImpersonatePage() {
  const [err, setErr] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (!token) {
      setErr(true);
      return;
    }
    try {
      // sessionStorage, NOT localStorage: this tab gets its own session so the
      // operator's Control Room login survives, even when the Control Room is
      // open on the same origin. See getToken() in lib/api.ts.
      sessionStorage.setItem("mise_token", token);
      // These two stay in localStorage because that is where they are READ
      // from. They only suppress a tour in the operator's own browser, so
      // there is nothing to isolate — unlike the token.
      localStorage.setItem("mise.tour.done", "1");
      localStorage.setItem("mise.setup.done", "1");
    } catch {
      setErr(true);
      return;
    }
    window.location.replace("/dashboard");
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center bg-[#0b1220] text-white">
      <p className="text-sm text-white/70">
        {err ? "No support token found — close this tab." : "Opening read-only support view…"}
      </p>
    </div>
  );
}
