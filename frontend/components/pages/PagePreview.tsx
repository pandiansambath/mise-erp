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
  return () => {
    mo.disconnect();
    for (const old of added) old.parentNode?.removeChild(old);
  };
  // A tap on "Order online" inside a PREVIEW must go nowhere — it is a
  // picture of the page, not the page. Capture phase so it lands before any
  // handler the real component attached.
  doc.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
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
      // FIT TO BOTH AXES. This fitted width only, so at 1440x900 a 390x844
      // phone rendered at 100% and its bottom ~128px sat below the window
      // edge — a preview whose job is showing the whole page, cutting the page
      // off. `min-h-0 flex-1` on the column is what gives clientHeight a value
      // to observe; without it this term is 0 and the old behaviour returns.
      setScale(Math.min(1, availW / w, availH > 0 ? availH / h : 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  const pad = device === "phone" ? 16 : 12;

  return (
    <div ref={box} className="w-full">
      <div
        className={`relative mx-auto overflow-hidden bg-black shadow-2xl ring-1 ring-black/20 ${
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
      <p className="mt-2 text-center text-[11px] text-fg-faint">
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
