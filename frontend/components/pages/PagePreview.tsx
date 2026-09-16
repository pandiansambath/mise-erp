"use client";

/** A preview that looks like the page, and BEHAVES like it.
 *
 *    "even the preview showcase [is] not correctly showing and weird to look —
 *     whole page is white and centre alone we showing the preview as small box,
 *     not nice."
 *
 *  Two problems, and only one of them is size.
 *
 *  1. A page designed at 1440px shown in a 400px box is not a small version of
 *     the page, it is a DIFFERENT page: the desktop layout never renders and the
 *     hero type that fills a laptop wraps to six lines. So the real component is
 *     laid out at a real viewport width and the whole thing is scaled down with
 *     a transform. What shrinks is the picture, not the page.
 *
 *  2. MEDIA QUERIES DO NOT CARE HOW WIDE THE ELEMENT IS. This is the part my
 *     first version got wrong, and the screenshot showed it immediately: a 390px
 *     phone preview inside a 1920px window still matched `min-width: 900px`, so
 *     the sign-in page rendered its DESKTOP split layout in a phone frame and
 *     the headline clipped to "Welc / back / to / NIRA". The element was the
 *     right width and every breakpoint was still wrong.
 *
 *     An iframe is the fix, because an iframe has its own viewport. Set it to
 *     390px and `min-width: 900px` genuinely stops matching. The page is then
 *     rendered INTO it with a portal, so it is still the live component reacting
 *     to unsaved edits rather than a screenshot or a saved URL.
 *
 *  The device frame is not decoration either: floating on white, a preview has
 *  no edges, so you cannot tell where the page stops and the editor begins —
 *  which is what made the old one read as "a weird small box".
 *
 *  ⚠️ THE CALLER MUST GIVE THIS A BOUNDED HEIGHT.
 *
 *      "they are hitting bottom" / "the previow is very worst its not
 *       responsvie..previw is cutting in bottom"
 *
 *  It fits the page to the room it is in, so it has to BE in a room. Render it
 *  as a flex child of a column that has a real height — the studio cell, or a
 *  card with an explicit `h-[...]`. Drop it into a plain block div and its
 *  measured height becomes its own content height, which means the height term
 *  silently evaluates to "whatever I already am" and only the width constrains
 *  anything. That is not a visible failure; it is a preview that looks fine on
 *  a laptop and runs off the bottom edge on everything else, which is why it
 *  survived two attempts at fixing it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Device = "desktop" | "phone";

/** Real viewport widths, not "small" and "large". The whole point is that the
 *  page lays out at a size somebody actually uses. */
const SIZE: Record<Device, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};

/** Copy the app's stylesheets into the iframe, and keep them in step.
 *
 *  An iframe starts with an empty document, so without this the page renders as
 *  unstyled HTML — its own kind of misleading preview. Cloning the parent's
 *  <style> and stylesheet <link> tags covers both dev (inline styles) and
 *  production (real CSS files).
 *
 *  A plain module-level function, not a hook: the React Compiler treats
 *  anything reachable from a hook argument as off-limits to mutate, and writing
 *  into another document is unavoidably mutation. Taking the document as a
 *  parameter and returning a teardown keeps it honest and keeps the compiler
 *  happy for the right reason rather than by suppression.
 */
function mirrorStyles(doc: Document): () => void {
  let added: HTMLElement[] = [];

  const copy = () => {
    for (const old of added) old.parentNode?.removeChild(old);
    added = [];
    for (const node of Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]'),
    )) {
      const clone = node.cloneNode(true) as HTMLElement;
      doc.head.appendChild(clone);
      added.push(clone);
    }
    // The theme lives on <html> as data-mode and the palette variables are
    // declared on :root, so without this the preview paints in the default
    // theme whatever the restaurant actually chose.
    const mode = document.documentElement.getAttribute("data-mode");
    if (mode) doc.documentElement.setAttribute("data-mode", mode);
    doc.body.setAttribute("style", "margin:0");
    doc.body.className = document.body.className;
  };

  copy();
  // Route changes and dev rebuilds inject new <style> tags; without watching
  // for them the preview silently drifts out of date.
  const mo = new MutationObserver(copy);
  mo.observe(document.head, { childList: true });

  // A tap on "Order online" inside a PREVIEW must go nowhere — it is a picture
  // of the page, not the page. Capture phase so it lands before any handler the
  // real component attached.
  //
  // THIS WAS WRITTEN BELOW THE `return` AND HAD NEVER ONCE RUN. Unreachable
  // code after a return is not an error in TypeScript and not a lint failure
  // here, so it type-checked, built, shipped and did nothing — clicks inside
  // the preview were live the whole time, which on the sign-in preview means a
  // click could try to actually sign in.
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  doc.addEventListener("click", swallow, true);
  doc.addEventListener("submit", swallow, true);

  return () => {
    mo.disconnect();
    doc.removeEventListener("click", swallow, true);
    doc.removeEventListener("submit", swallow, true);
    for (const old of added) old.parentNode?.removeChild(old);
  };
}

export function PagePreview({
  device,
  children,
  /** Shown over the frame while saving, so the preview never silently
   *  disagrees with what is stored. */
  note,
}: {
  device: Device;
  children: ReactNode;
  note?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const teardown = useRef<(() => void) | null>(null);

  // ATTACH FROM AN EFFECT, NOT FROM onLoad.
  //
  // A src-less iframe does not reliably fire `load` — the first screenshot of
  // this showed a perfectly built editor around a blank white rectangle,
  // because `onLoad` never ran, `doc` stayed null and the portal never mounted.
  // After mount the contentDocument is there to be taken, so take it; the small
  // retry covers the browsers that leave `about:blank` a tick behind.
  useEffect(() => {
    let tries = 0;
    let timer: number | undefined;
    const attach = () => {
      const d = frame.current?.contentDocument;
      if (d && d.body) {
        teardown.current?.();
        teardown.current = mirrorStyles(d);
        setDoc(d);
        return;
      }
      if (tries++ < 20) timer = window.setTimeout(attach, 25);
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      teardown.current?.();
      teardown.current = null;
    };
  }, [device]);

  const [scale, setScale] = useState(0.5);
  const { w, h } = SIZE[device];

  // The bezel is not free. `p-2` on a phone and `p-1.5` on a laptop are real
  // pixels around the screen, and the laptop also carries a 24px browser-chrome
  // strip above it. Fitting `h` into the available height and then drawing
  // those on top is how the frame ends up taller than the space it was measured
  // against — which is the bottom edge he keeps photographing.
  const pad = device === "phone" ? 16 : 12;
  const chrome = device === "desktop" ? 24 : 0;

  // Fit to whatever room the editor leaves us, and re-fit when that changes.
  // ResizeObserver rather than a window listener: the preview column resizes
  // when the editor panel opens and closes, which no window event reports.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      if (availW <= 0) return;

      // WHY THIS WAS STILL WRONG AFTER I "FIXED" IT.
      //
      // The height term was already here. It never did anything, because the
      // element being measured was `<div class="w-full">` — a block div, whose
      // clientHeight IS its content. So `availH` was whatever the frame had
      // already decided to be, the ratio was always >= 1, and `Math.min` threw
      // it away every time. A constraint computed from the thing it is meant to
      // constrain is not a constraint. The parent chain was bounded the whole
      // time; the ruler was the problem.
      //
      // `box` is now a flex child with `min-h-0 flex-1`, so clientHeight is the
      // room actually left over after the caption — a number that does not
      // depend on the frame at all.
      const fitsW = (availW - pad) / w;
      const fitsH = (availH - pad - chrome) / h;
      setScale(Math.max(0.05, Math.min(1, fitsW, fitsH)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, pad, chrome]);

  return (
    /* THREE ELEMENTS, EACH WITH ONE JOB — and the middle one is the fix.
       -----------------------------------------------------------------------
       outer:  fills the height it is given (`h-full min-h-0`), column flex.
       box:    `min-h-0 flex-1` — it CANNOT size to its content, so measuring it
               gives the room left over. This is the element the old code got
               wrong by making it `w-full` and nothing else.
       caption: `shrink-0`, outside the measured area, so the two lines of text
               under the frame stop silently stealing the height the frame was
               told it could have.
       `min-h-0` is load-bearing on both: a flex child defaults to min-height
       auto, which lets it push past its parent — the exact overflow being
       photographed. */
    <div className="flex min-h-0 w-full flex-1 flex-col items-center">
      <div ref={box} className="flex min-h-0 w-full flex-1 items-center justify-center">
      <div
        className={`relative overflow-hidden bg-black shadow-2xl ring-1 ring-black/20 ${
          device === "phone" ? "rounded-[2.25rem] p-2" : "rounded-xl p-1.5"
        }`}
        style={{ width: w * scale + pad, transition: "width .2s" }}
      >
        {device === "desktop" && (
          /* A browser chrome strip — a screenshot of a website with no window
             around it reads as an image, not as a page. */
          <div className="flex h-6 items-center gap-1.5 px-2">
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            ))}
            <span className="ml-2 h-3.5 flex-1 rounded-full bg-white/10" />
          </div>
        )}
        <div
          className="relative overflow-hidden bg-white"
          style={{
            width: w * scale,
            height: h * scale,
            borderRadius: device === "phone" ? "1.75rem" : "0.35rem",
          }}
        >
          <iframe
            ref={frame}
            title="Preview"
            // `key` forces a fresh document when the device changes. Resizing an
            // existing iframe does re-run media queries, but a clean document is
            // cheaper to reason about than a half-torn-down portal.
            key={device}
            onLoad={(e) => {
              // Belt and braces: if the document IS replaced on load, re-mirror
              // into the new one. The effect above is what normally attaches.
              const d = e.currentTarget.contentDocument;
              if (d && d !== doc) {
                teardown.current?.();
                teardown.current = mirrorStyles(d);
                setDoc(d);
              }
            }}
            // SCROLLABLE, BUT NOT CLICKABLE.
            //
            // `pointer-events-none` made the frame inert — so a page taller
            // than the device could never be seen below the fold, and the old
            // transform-scaled preview grew a spacer hack to fake it. In an
            // iframe the scrollHeight is real, so the wheel can just work; the
            // clicks are swallowed inside the document instead (see the
            // capture-phase listener where the styles are mirrored).
            className="origin-top-left border-0"
            style={{
              width: w,
              height: h,
              transform: `scale(${scale})`,
              transition: "transform .2s",
            }}
          />
          {/* The live component, rendered INTO the iframe. Still the real page
              reacting to unsaved edits — it simply lays out against a viewport
              that is genuinely 390 or 1440 wide. */}
          {doc?.body && createPortal(children, doc.body)}
        </div>
        {note && (
          <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {note}
          </p>
        )}
      </div>
      </div>
      <p className="mt-2 shrink-0 text-center text-[11px] text-fg-faint">
        {device === "desktop" ? "1440 × 900 — laptop" : "390 × 844 — phone"} ·{" "}
        {Math.round(scale * 100)}%
      </p>
    </div>
  );
}

export function DeviceSwitch({
  device,
  onChange,
}: {
  device: Device;
  onChange: (d: Device) => void;
}) {
  return (
    <div className="mise-well flex rounded-xl p-0.5">
      {(
        [
          ["desktop", "🖥", "Laptop"],
          ["phone", "📱", "Phone"],
        ] as const
      ).map(([k, icon, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`mise-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            device === k ? "bg-brand-600 text-white" : "text-fg-faint"
          }`}
        >
          <span aria-hidden>{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}
