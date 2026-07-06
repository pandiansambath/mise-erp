"use client";

// A guided tour that actually WALKS you through the app: each step navigates to a
// real page and a floating card explains what you're looking at, while the matching
// section lights up in the sidebar. The tour (not the user) drives the movement.
// Dependency-free + CSP-safe. Persists completion so it only auto-runs once.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const KEY = "mise.tour.done";

type Step = { href: string; title: string; body: string; emoji: string };

const STEPS: Step[] = [
  { href: "/dashboard", title: "Welcome to Mise 👋", body: "A quick walk through where everything lives — I'll drive, you just tap Next. This is your Dashboard: today's takings, this month's profit and low stock, at a glance.", emoji: "▦" },
  { href: "/money", title: "Money", body: "The plain-English money story: sales − food − running costs = what you keep. Waste and every other cost land here too.", emoji: "💰" },
  { href: "/inventory", title: "Inventory", body: "Every item with live stock, a health bar and pack sizes (1 box = 5 kg) — so recipes cost in the base unit but you order in packs.", emoji: "📦" },
  { href: "/recipes", title: "Recipes", body: "Cost each dish from its ingredients, so you always know its real margin before you set a price.", emoji: "🍲" },
  { href: "/purchasing", title: "Purchasing", body: "Turn a shopping list into supplier orders, then receive deliveries into stock — even short ones, with a goods-received note.", emoji: "🛒" },
  { href: "/sales", title: "Sales & Cash", body: "Log daily takings by channel and balance the till. This feeds your profit and the dashboards.", emoji: "🧾" },
  { href: "/rota", title: "Rota", body: "Schedule shifts and watch forecast labour cost as a % of sales. Copy a past week in one click.", emoji: "🗓️" },
  { href: "/payroll", title: "Payroll", body: "Run pay from attendance, record advances, approve everyone, and issue payslip PDFs.", emoji: "💷" },
  { href: "/profile", title: "Make it yours 🎨", body: "Add your hotel details + logo here (it shows in the sidebar and on your PDFs). Switch themes from the swatch in the top bar. That's the tour — enjoy!", emoji: "🎨" },
];

/** Should the tour auto-start (first time only)? */
export function shouldAutoStartTour(): boolean {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Every close path funnels through finish() so `i` is reset to 0 for next time.
  const finish = useCallback(() => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setI(0);
    onClose();
  }, [onClose]);

  // Drive the app: navigate to this step's page, scroll its sidebar item into view
  // (so the active highlight is always visible), and reset the page scroll to the top.
  useEffect(() => {
    if (!open) return;
    router.push(step.href);
    const slug = step.href.slice(1);
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-tour="${slug}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    }, 70);
    return () => window.clearTimeout(t);
  }, [open, i, step.href, router]);

  // Keyboard: →/Enter next · ← back · Esc skip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") setI((x) => (x >= STEPS.length - 1 ? x : x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;

  return (
    <>
      {/* Soft bottom vignette so the floating card reads clearly, without hiding the
          page we're actually touring. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[65]"
        style={{ boxShadow: "inset 0 -190px 130px -90px rgba(4,7,13,0.6)" }}
      />

      <div
        className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4 pb-5 pt-2"
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
      >
        <div
          key={i}
          className="mise-pop pointer-events-auto relative w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-brand-400/30 bg-paper-2/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700" />
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-2xl ring-1 ring-brand-400/30">
              {step.emoji}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-fg">{step.title}</h3>
                <span className="shrink-0 text-xs text-fg-faint">
                  {i + 1}/{STEPS.length}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-fg-soft">{step.body}</p>
            </div>
          </div>

          {/* progress dots */}
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((_, k) => (
              <span
                key={k}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  k === i ? "w-5 bg-brand-500" : k < i ? "w-1.5 bg-brand-500/50" : "w-1.5 bg-glass/15"
                }`}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={finish}
              className="text-xs font-medium text-fg-faint hover:text-fg-soft"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => setI((x) => Math.max(0, x - 1))}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-paper"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => (last ? finish() : setI((x) => x + 1))}
                className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 active:scale-95"
              >
                {last ? "Finish 🎉" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
