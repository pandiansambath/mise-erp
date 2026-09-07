"use client";

// THE PREVIEW DOCK.
//
//   "this preview page is there nah, its dynamically changing whenever we do
//    changes — but dimension and view wise its failing. so whenever we open
//    setting page, open this in full entire UI, and left side we can show
//    setting, right side u can use 2 view: 1 is 9:16 another is 16:9. both
//    screen need to show the preview. so total 4 (2 for landing page of hotel
//    and 2 for login page of hotel)"
//
// WHAT WAS ACTUALLY WRONG. The previews were live and correct — and useless,
// because each was a ~400px-wide box inside a 2xl-wide column. A page designed
// for a 1280px laptop was being judged in a slot a third that size, which is
// not a preview of anything: the hero wraps, the columns stack, and you are
// looking at the phone layout while trying to decide how the laptop one reads.
//
// So the page it renders is given its REAL dimensions — 1280×720 for a laptop,
// 390×844 for a phone — and the whole thing is scaled down to fit the dock.
// Scaling is what makes it truthful: the component still lays itself out at the
// width it will really have, and only the pixels shrink.
//
// One consequence worth knowing: a `transform` makes this element the containing
// block for anything `position: fixed` inside it. Both previewed components run
// in `preview` mode and paint nothing fixed, which is why this is safe here and
// would not be for an arbitrary page.

import { useEffect, useRef, useState, type ReactNode } from "react";

type Shape = "wide" | "tall";
type Which = "site" | "door";

const SIZES: Record<Shape, { w: number; h: number; label: string; hint: string }> = {
  wide: { w: 1280, h: 720, label: "16:9", hint: "laptop" },
  tall: { w: 390, h: 844, label: "9:16", hint: "phone" },
};

export function SettingsPreview({
  site,
  door,
  host,
  className = "",
}: {
  /** The public page, rendered by the real component. */
  site: ReactNode;
  /** The staff sign-in page, likewise. */
  door: ReactNode;
  host: string;
  className?: string;
}) {
  const [which, setWhich] = useState<Which>("site");
  const [shape, setShape] = useState<Shape>("wide");
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  const size = SIZES[shape];

  // Measure rather than assume: the dock is a fraction of a window that can be
  // any width, and a hard-coded scale would be right on exactly one monitor.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / size.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w]);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="mise-card-inset flex gap-1 rounded-xl p-1">
          {(
            [
              ["site", "Public page"],
              ["door", "Sign-in page"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setWhich(key)}
              data-testid={`preview-${key}`}
              className={`mise-press min-h-[34px] rounded-lg px-3 text-xs font-semibold transition ${
                which === key ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mise-card-inset flex gap-1 rounded-xl p-1">
          {(Object.keys(SIZES) as Shape[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setShape(key)}
              data-testid={`preview-${key}`}
              title={SIZES[key].hint}
              className={`mise-press min-h-[34px] rounded-lg px-3 text-xs font-semibold transition ${
                shape === key ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
              }`}
            >
              {SIZES[key].label}
              <span className="ml-1 opacity-60">{SIZES[key].hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/30">
        <div className="flex items-center gap-1.5 border-b border-line bg-paper-2 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-2 truncate text-[11px] text-fg-faint">
            {host || "yourhandle.dineai.cloud"}
            {which === "door" ? "/login" : ""}
          </span>
        </div>

        {/* The frame is the real aspect ratio, so a 9:16 preview is genuinely
            the shape of a phone rather than a narrow slice of a laptop. */}
        <div
          ref={boxRef}
          className="relative w-full overflow-hidden bg-shell"
          style={{ height: `${size.h * scale}px` }}
        >
          <div
            style={{
              width: `${size.w}px`,
              height: `${size.h}px`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            // Nothing in here is clickable: it is a picture of a page, and a
            // half-working copy of a sign-in form inside a settings screen is
            // worse than an obviously inert one.
            aria-hidden
            className="pointer-events-none overflow-hidden"
          >
            {which === "site" ? site : door}
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-fg-faint">
        Shown at {size.w}×{size.h} and scaled to fit — the page lays itself out at
        the width it will really have, so this is what people get.
      </p>
    </div>
  );
}
