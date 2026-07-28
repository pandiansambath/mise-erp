"use client";

// The per-hotel branded site served at <handle>.dineai.cloud.
// Public (no auth) — the hotel's own front door. The middleware rewrites the
// subdomain root here; /login, /order/… etc. still pass through untouched.
// All the design lives in <HotelSite> so Settings can preview the real thing.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE, type HotelLanding } from "@/lib/api";
import HotelSite from "@/components/site/HotelSite";

export default function HotelLandingPage() {
  const { handle } = useParams<{ handle: string }>();
  const [data, setData] = useState<HotelLanding | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    if (!handle) return;
    fetch(`${API_BASE}/api/public/hotel-landing/${encodeURIComponent(handle)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: HotelLanding) => { setData(d); setState("ok"); })
      .catch(() => setState("missing"));
  }, [handle]);

  useEffect(() => {
    if (data) document.title = `${data.name} — ${data.landing?.tagline || "Welcome"}`;
  }, [data]);

  if (state === "loading") {
    return (
      <div className="grid min-h-[100svh] place-items-center" style={{ background: "#080c0b" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
      </div>
    );
  }

  if (state === "missing" || !data) {
    return (
      <div style={{ minHeight: "100svh", background: "#080c0b", color: "#f2f6f5" }}
           className="flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-semibold">This site isn’t set up yet</p>
        <p className="text-sm text-white/50">No hotel is using the handle “{handle}”.</p>
        <a href="https://dineai.cloud"
           className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
          Go to DineAI →
        </a>
      </div>
    );
  }

  return <HotelSite data={data} />;
}
