"use client";

// The per-hotel branded landing page served at <handle>.dineai.cloud.
// Public (no auth) — it's the hotel's own front door. The middleware rewrites
// the subdomain root here; /login etc. still pass through so people can sign in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { API_BASE, type HotelLanding } from "@/lib/api";

type Theme = { bg: string; panel: string; fg: string; sub: string; line: string };

const THEMES: Record<string, Theme> = {
  dark: { bg: "#0a0f0d", panel: "rgba(255,255,255,0.04)", fg: "#f1f5f4", sub: "#9aa8a3", line: "rgba(255,255,255,0.10)" },
  light: { bg: "#f7f8f7", panel: "rgba(0,0,0,0.03)", fg: "#0f1a17", sub: "#5b6b66", line: "rgba(0,0,0,0.08)" },
  warm: { bg: "#f6f1e7", panel: "rgba(0,0,0,0.03)", fg: "#2a2218", sub: "#7a6c57", line: "rgba(0,0,0,0.08)" },
};

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "🍽";
}

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

  if (state === "loading") {
    return <div style={{ minHeight: "100svh", background: "#0a0f0d" }} />;
  }
  if (state === "missing" || !data) {
    return (
      <div style={{ minHeight: "100svh", background: "#0a0f0d", color: "#f1f5f4" }}
           className="flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-semibold">This site isn’t set up yet</p>
        <p className="text-sm text-white/50">No hotel is using the handle “{handle}”.</p>
        <a href="https://dineai.cloud" className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">Go to Mise →</a>
      </div>
    );
  }

  const L = data.landing;
  const t = THEMES[L.theme] ?? THEMES.dark;
  const accent = L.accent || "#059669";
  const tagline = L.tagline || (data.city ? `A kitchen in ${data.city}` : "Every plate, every penny.");

  return (
    <main style={{ minHeight: "100svh", background: t.bg, color: t.fg }} className="relative overflow-hidden">
      {/* soft accent glow */}
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(60% 55% at 50% -10%, ${accent}22, transparent 70%)`,
      }} />
      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col items-center px-6 py-16 text-center">
        {/* logo / monogram */}
        {data.has_logo && data.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_BASE}${data.logo_url}`} alt={data.name}
               className="h-20 w-20 rounded-2xl object-contain" style={{ background: t.panel }} />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-2xl text-2xl font-bold text-white"
               style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)` }}>
            {monogram(data.name)}
          </div>
        )}

        <h1 className="mt-7 text-4xl font-bold tracking-tight sm:text-5xl">{data.name}</h1>
        <p className="mt-3 text-lg" style={{ color: t.sub }}>{tagline}</p>

        {L.about && (
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed" style={{ color: t.sub }}>{L.about}</p>
        )}

        {L.quote && (
          <blockquote className="mt-8 max-w-md border-l-2 pl-4 text-left text-[15px] italic"
                      style={{ borderColor: accent, color: t.fg }}>
            “{L.quote}”
          </blockquote>
        )}

        {/* actions */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login"
             className="rounded-xl px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
             style={{ background: accent }}>
            Log in →
          </Link>
          {L.show_order && (
            <Link href={data.order_url}
               className="rounded-xl border px-6 py-3 text-sm font-semibold transition"
               style={{ borderColor: t.line, color: t.fg }}>
              Order online
            </Link>
          )}
        </div>

        <div className="mt-auto pt-14">
          <a href="https://dineai.cloud" className="text-xs" style={{ color: t.sub }}>
            Powered by <b style={{ color: t.fg }}>Mise</b> · every plate, every penny
          </a>
        </div>
      </div>
    </main>
  );
}
