"use client";

// THE PREVIEW — a real one.
//
//   "that preview is not fitting to screen, i need to scroll to see the bottom.
//    also we need a real preview: if i scroll inside the preview then that page
//    need to be scrolled, not the design page."
//
// Both halves of that are the same mistake. The frame was sized to the whole
// scaled page, so a long page made a long frame and the STUDIO scrolled — you
// moved the editor to see the bottom of the thing you were editing, and the
// controls slid away while you did it.
//
// A device does not work that way. A phone is a fixed window with a page moving
// behind it. So the frame is now exactly the space available, and the page
// scrolls INSIDE it. That is also what makes it honest: a hero that fills a
// laptop screen should fill this frame too, and you should have to scroll to
// find out what is under the fold — because your customers will.
//
// Scrolling works while clicks do not: the scaled page carries
// `pointer-events: none`, so a wheel or a drag is handled by the frame around
// it and a tap on "Order online" does nothing. A preview that can be navigated
// away from is not a preview.

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
  site: ReactNode;
  door: ReactNode;
  host: string;
  className?: string;
}) {
  const [which, setWhich] = useState<Which>("site");
  const [shape, setShape] = useState<Shape>("wide");
  const shellRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  // The real, unscaled height of the page being previewed. Measured, because a
  // hero page and a sign-in page are nothing like the same length.
  const [contentH, setContentH] = useState(720);

  const size = SIZES[shape];

  // Fit the frame to the room it has, in BOTH directions. Measuring only the
  // width is what made the phone 1038px tall inside a 700px pane.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setScale(Math.min(1, w / size.w, h / size.h));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w, size.h]);

  // Watch the previewed page itself: switching from the public page to the
  // sign-in page changes its length entirely, and the spacer must follow.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const read = () => setContentH(Math.max(size.h, el.scrollHeight));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [which, shape, size.h]);

  const frameW = Math.round(size.w * scale);
  const frameH = Math.round(size.h * scale);

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
              className={`mise-press min-h-[36px] rounded-lg px-3.5 text-xs font-semibold transition ${
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
              className={`mise-press min-h-[36px] rounded-lg px-3.5 text-xs font-semibold transition ${
                shape === key ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
              }`}
            >
              {SIZES[key].label}
              <span className="ml-1 opacity-60">{SIZES[key].hint}</span>
            </button>
          ))}
        </div>

        <span className="ml-auto text-[11px] text-fg-faint">scroll inside it ↓</span>
      </div>

      {/* The shell is the room available; the frame is the device inside it. */}
      <div ref={shellRef} className="grid min-h-0 flex-1 place-items-center">
        <div
          className="overflow-hidden rounded-2xl border border-line shadow-2xl shadow-black/30"
          style={{ width: `${frameW}px` }}
        >
          <div className="flex items-center gap-1.5 border-b border-line bg-paper-2 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-2 truncate text-[11px] text-fg-faint">
              {host || "yourhandle.dineai.cloud"}
              {which === "door" ? "/login" : ""}
            </span>
          </div>

          <div
            className="mise-noscrollbar overflow-y-auto overscroll-contain bg-shell"
            style={{ width: `${frameW}px`, height: `${frameH}px` }}
          >
            {/* WHY IT SCROLLED PAST THE END.
                `transform: scale()` is a PAINT operation and changes nothing
                about layout. A 3000px page scaled to 0.5 still occupied 3000px
                of scroll height while painting only 1500px — so the second half
                of the scrollbar was empty space under a page that had already
                finished.
                This spacer carries the SCALED height and the page is laid over
                it, so the scrollbar now ends where the page ends. */}
            <div style={{ height: `${Math.round(contentH * scale)}px`, position: "relative" }}>
              <div
                ref={innerRef}
                style={{
                  width: `${size.w}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
                aria-hidden
                className="pointer-events-none"
              >
                {which === "site" ? site : door}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-2 shrink-0 text-center text-[11px] text-fg-faint">
        {size.w}×{size.h}, scaled to fit — the page lays itself out at the width it
        will really have, so this is what people get.
      </p>
    </div>
  );
}
