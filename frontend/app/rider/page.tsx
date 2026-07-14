"use client";

// 🛵 The rider door — phone-first, its own lightweight login (phone + PIN the
// hotel issues). Go online, see your job as two legs (to the kitchen → to the
// customer), tap-to-navigate, and while a job is active the page beacons GPS
// every few seconds — that stream IS the customer's live map.

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ThemeSwitcher } from "@/components/AppShell";
import { THEMES, themeVars, useTheme } from "@/lib/theme";

type Job = {
  id: string;
  code: string;
  status: string;
  customer_name: string;
  phone: string;
  address_text: string | null;
  address_lat: string | null;
  address_lng: string | null;
  note: string | null;
  total: string;
  items: { name: string; quantity: number }[];
};
type Me = {
  rider: { id: string; name: string; online: boolean };
  hotel: { name: string; city: string | null };
  active: Job | null;
  delivered_total: number;
};

const TOKEN_KEY = "mise_rider_token";

async function riderApi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}`,
      ...init?.headers,
    },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Request failed");
  return r.json();
}

export default function RiderPage() {
  const { theme } = useTheme();
  const themed = { ...themeVars(theme), colorScheme: THEMES[theme].light ? "light" : ("dark" as const) };
  const [me, setMe] = useState<Me | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinIn, setPinIn] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [handErr, setHandErr] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastPost = useRef(0);

  const load = useCallback(() => {
    riderApi<Me>("/rider/me")
      .then((m) => { setMe(m); setAuthed(true); })
      .catch(() => { setAuthed(false); });
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) { setAuthed(false); return; }
    load();
    const t = window.setInterval(load, 10000); // jobs land without refreshing
    return () => window.clearInterval(t);
  }, [load]);

  // The beacon: while ONLINE with an ACTIVE job, stream GPS (throttled to ~5s).
  useEffect(() => {
    const shouldBeacon = !!me?.rider.online && !!me?.active;
    if (shouldBeacon && watchId.current === null && navigator.geolocation) {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          if (now - lastPost.current < 5000) return;
          lastPost.current = now;
          riderApi("/rider/location", {
            method: "POST",
            body: JSON.stringify({
              lat: pos.coords.latitude.toFixed(6),
              lng: pos.coords.longitude.toFixed(6),
            }),
          }).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 },
      );
    }
    if (!shouldBeacon && watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [me?.rider.online, me?.active]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/rider/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.detail ?? "Wrong phone or PIN");
      localStorage.setItem(TOKEN_KEY, body.access_token);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string) {
    setBusy(true);
    try {
      await riderApi(path, { method: "POST", body: JSON.stringify({}) });
      load();
    } catch { /* poll will settle it */ } finally { setBusy(false); }
  }

  const inputCls =
    "mise-well w-full rounded-xl px-3.5 py-3 text-base text-fg outline-none focus:ring-2 focus:ring-brand-400/30";

  if (authed === false) {
    return (
      <div data-mode={THEMES[theme].light ? "light" : "dark"} style={themed} className="mise-app grid min-h-screen place-items-center bg-shell p-5 text-fg">
        <form onSubmit={login} className="mise-feel w-full max-w-sm space-y-4 rounded-3xl border border-line bg-paper p-6 text-center">
          <p className="text-4xl" aria-hidden>🛵</p>
          <h1 className="font-display text-2xl text-fg">Rider sign-in</h1>
          <p className="text-sm text-fg-faint">Use the phone number + PIN your kitchen gave you.</p>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="Phone number" aria-label="Phone" className={inputCls} />
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} required inputMode="numeric" placeholder="PIN" aria-label="PIN" className={`${inputCls} text-center font-mono tracking-[0.3em]`} />
          {error && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{error}</p>}
          <button type="submit" disabled={busy} className="mise-press w-full rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? "Signing in…" : "Start my shift →"}
          </button>
        </form>
      </div>
    );
  }

  const job = me?.active ?? null;
  const leg = job?.status === "OUT_FOR_DELIVERY" ? "customer" : "kitchen";

  return (
    <div data-mode={THEMES[theme].light ? "light" : "dark"} style={themed} className="mise-app min-h-screen bg-shell pb-10 text-fg">
      <header className="sticky top-0 z-40 border-b border-glass/10 bg-shell/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <span className="text-2xl" aria-hidden>🛵</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{me?.rider.name ?? "…"}</p>
            <p className="text-[11px] text-fg-faint">{me?.hotel.name} · {me?.delivered_total ?? 0} delivered</p>
          </div>
          <ThemeSwitcher />
          <button
            type="button"
            onClick={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); setMe(null); }}
            className="mise-raised mise-press rounded-lg px-2.5 py-1.5 text-xs text-fg-soft"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-5">
        {/* online switch */}
        <button
          type="button"
          onClick={() => {
            if (!me) return;
            riderApi("/rider/online", {
              method: "POST",
              body: JSON.stringify({ online: !me.rider.online }),
            }).then(load).catch(() => {});
          }}
          className={`mise-press w-full rounded-2xl px-4 py-4 text-sm font-bold ${
            me?.rider.online
              ? "bg-emerald-500/15 text-emerald-500"
              : "mise-raised text-fg-soft"
          }`}
        >
          {me?.rider.online ? "🟢 ONLINE — ready for jobs (tap to go offline)" : "⚪ OFFLINE — tap to start taking jobs"}
        </button>

        {!job ? (
          <div className="mise-well rounded-3xl p-10 text-center">
            <p className="text-4xl" aria-hidden>{me?.rider.online ? "📡" : "☕"}</p>
            <p className="mt-3 font-semibold text-fg">
              {me?.rider.online ? "Waiting for the kitchen…" : "You're off duty"}
            </p>
            <p className="mt-1 text-sm text-fg-faint">
              {me?.rider.online
                ? "New deliveries appear here the moment you're assigned."
                : "Go online and the kitchen can send you deliveries."}
            </p>
          </div>
        ) : (
          <div className="mise-feel rounded-3xl border border-line bg-paper p-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-lg font-bold text-fg">{job.code}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${leg === "kitchen" ? "bg-amber-500/15 text-amber-500" : "bg-cyan-500/15 text-cyan-400"}`}>
                {leg === "kitchen" ? "① COLLECT FROM KITCHEN" : "② DELIVER TO CUSTOMER"}
              </span>
            </div>
            <ul className="mt-3 space-y-0.5 text-sm text-fg-soft">
              {job.items.map((i, n) => (
                <li key={n}>{i.quantity}× {i.name}</li>
              ))}
            </ul>
            <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
              <p className="font-semibold text-fg">{job.customer_name} · £{job.total}</p>
              {job.address_text && <p className="text-fg-soft">📍 {job.address_text}</p>}
              {job.note && <p className="text-xs text-fg-faint">📝 “{job.note}”</p>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={`tel:${job.phone}`}
                className="mise-raised mise-press rounded-xl px-3 py-3 text-center text-sm font-semibold text-fg-soft"
              >
                📞 Call
              </a>
              {job.address_lat && job.address_lng ? (
                <a
                  href={`https://maps.google.com/?q=${job.address_lat},${job.address_lng}`}
                  target="_blank" rel="noreferrer"
                  className="mise-raised mise-press rounded-xl px-3 py-3 text-center text-sm font-semibold text-fg-soft"
                >
                  🧭 Navigate
                </a>
              ) : (
                <span className="mise-well rounded-xl px-3 py-3 text-center text-xs text-fg-faint">no pin — use the address</span>
              )}
            </div>
            {leg === "kitchen" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => act(`/rider/orders/${job.id}/pickup`)}
                className="mise-press mt-3 w-full rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-4 text-sm font-bold text-white shadow-lg shadow-brand-500/25 disabled:opacity-60"
              >
                ✅ Picked up — heading out
              </button>
            ) : (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <p className="text-xs font-semibold text-fg-soft">
                  🔐 Handover proof — ask the customer for their PIN, snap the food at the door:
                </p>
                <input
                  value={pinIn}
                  onChange={(e) => setPinIn(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="customer PIN"
                  aria-label="Customer PIN"
                  className="mise-well w-full rounded-xl px-3.5 py-3 text-center font-mono text-xl tracking-[0.3em] text-fg outline-none"
                />
                <label className={`mise-press block cursor-pointer rounded-xl px-3 py-3 text-center text-sm font-semibold ${photo ? "bg-emerald-500/15 text-emerald-500" : "mise-raised text-fg-soft"}`}>
                  {photo ? "📸 photo ready ✓ (tap to retake)" : "📸 Take doorstep photo"}
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                {handErr && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{handErr}</p>}
                <button
                  type="button"
                  disabled={busy || pinIn.length < 4 || !photo}
                  onClick={async () => {
                    setBusy(true);
                    setHandErr(null);
                    try {
                      const fd = new FormData();
                      fd.append("pin", pinIn);
                      fd.append("photo", photo!);
                      const r = await fetch(`${API_BASE}/api/rider/orders/${job.id}/deliver`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}` },
                        body: fd,
                      });
                      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Could not complete");
                      setPinIn(""); setPhoto(null);
                      load();
                    } catch (e2) {
                      setHandErr(e2 instanceof Error ? e2.message : "Could not complete");
                    } finally { setBusy(false); }
                  }}
                  className="mise-press w-full rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-4 text-sm font-bold text-white shadow-lg shadow-brand-500/25 disabled:opacity-60"
                >
                  🎉 Delivered — complete order
                </button>
              </div>
            )}
            <p className="mt-2 text-center text-[11px] text-fg-faint">
              📡 your location streams to the customer&apos;s live map while you ride
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
