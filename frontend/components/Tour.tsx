"use client";

// A lightweight, dependency-free guided tour: a smooth animated "spotlight" that
// glides between sidebar sections with a glassy step card. CSP-safe (no CDN/libs),
// works on desktop (spotlight) and gracefully centres the card on mobile where the
// sidebar is off-canvas. Persists completion so it only auto-runs once.
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

const KEY = "mise.tour.done";

type Step = { target?: string; title: string; body: string; emoji: string };

const STEPS: Step[] = [
  { title: "Welcome to Mise", body: "A 60-second tour of where everything lives. Skip whenever you like.", emoji: "✨" },
  { target: "dashboard", title: "Dashboard", body: "Your restaurant at a glance — today's takings, this month's profit, low stock.", emoji: "▦" },
  { target: "money", title: "Money", body: "The plain-English money story: sales − food − running costs = what you keep.", emoji: "💰" },
  { target: "inventory", title: "Inventory", body: "Every item with live stock, a health bar, pack sizes (1 box = 5 kg) and suppliers.", emoji: "📦" },
  { target: "recipes", title: "Recipes", body: "Cost each dish from its ingredients, so you always know its real margin.", emoji: "🍲" },
  { target: "purchasing", title: "Purchasing", body: "Raise orders to suppliers and receive deliveries into stock — even short ones.", emoji: "🛒" },
  { target: "sales", title: "Sales & Cash", body: "Log daily takings by channel and balance the till.", emoji: "🧾" },
  { target: "rota", title: "Rota", body: "Schedule shifts and watch forecast labour cost as a % of sales.", emoji: "🗓️" },
  { target: "payroll", title: "Payroll", body: "Run pay from attendance, handle advances, and issue payslips.", emoji: "💷" },
  { target: "profile", title: "Make it yours", body: "Add your hotel details + logo in Profile. Themes live in the top bar.", emoji: "🎨" },
  { title: "You're all set", body: "Explore freely, or tap ✨ Ask Mise any time for help. Enjoy!", emoji: "🚀" },
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
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setI(0);
    onClose();
  }, [onClose]);

  const measure = useCallback(() => {
    const t = STEPS[i].target;
    if (!t) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${t}"]`) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "auto" });
    const r = el.getBoundingClientRect();
    setRect(r.width > 4 && r.height > 4 ? r : null);
  }, [i]);

  useLayoutEffect(() => {
    if (open) requestAnimationFrame(measure);
  }, [open, i, measure]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") setI((x) => Math.min(STEPS.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, measure, finish]);

  if (!open) return null;

  // Card placement: to the right of a spotlit sidebar item, else screen-centred.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const CARD_W = 320;
  const centred = !rect || vw < 640;
  const cardStyle: CSSProperties = centred
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : {
        left: Math.min((rect as DOMRect).right + 18, vw - CARD_W - 16),
        top: Math.max(16, Math.min((rect as DOMRect).top - 8, vh - 260)),
      };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Dim + spotlight. The huge box-shadow darkens everything except the target. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand-400 transition-all duration-500 ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(4,7,13,0.74)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(4,7,13,0.74)] backdrop-blur-sm" />
      )}

      {/* Click anywhere (except the card) advances. */}
      <button
        type="button"
        aria-label="Next"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={() => (last ? finish() : setI((x) => x + 1))}
      />

      {/* Step card */}
      <div
        key={i}
        className="mise-pop absolute w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-brand-400/30 bg-paper-2/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
        style={cardStyle}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700" />
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-xl ring-1 ring-brand-400/30">
            {step.emoji}
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-fg">{step.title}</h3>
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
              {last ? "Finish 🎉" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
