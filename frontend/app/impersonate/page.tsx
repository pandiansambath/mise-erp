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
      localStorage.setItem("mise_token", token);
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
