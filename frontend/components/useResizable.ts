"use client";

// Let the user decide how big the assistant is, and where it sits.
//
// His ask: *"we can allow user to move this ai chat box too wherever they want,
// also they can even reduce the size of that view too by using the edges…
// also note our chatbox needs to obey the sizing — the input field, text,
// everything needs to obey."*
//
// That last clause is the one that matters. Plenty of resizable panels change
// their frame and leave the contents laid out for the old one, so you end up
// with a narrow box containing a wide toolbar. Here the panel writes its real
// width into a data attribute, and the contents key off that — so a narrow
// panel genuinely becomes a narrow layout, not a clipped wide one.
//
// Pointer events throughout: one code path for mouse, finger and stylus.
// Size and position persist, because resizing something twice a day is worse
// than it being the wrong size once.

import { useCallback, useEffect, useRef, useState } from "react";

export type Box = { w: number; h: number; x: number | null; y: number | null };

/** Below this a chat panel stops being usable; above it, it is a window. */
const MIN_W = 300;
const MIN_H = 320;

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/** Breathing room kept between the panel and the edges of the window. */
const MARGIN = 8;

/** Keep a panel where it can still be grabbed.
 *
 *  Nothing bounded this before, and the failure was one-way: the drag handle
 *  IS the header, so the moment the top edge went above the viewport there was
 *  nothing left to grab and the panel could never be moved back. He hit
 *  exactly that — "i cant able to drag and move… also top portion is hidden".
 *
 *  So the top is pinned at or below the window's top edge, and the panel is
 *  never pushed so far sideways that the header leaves the screen. Also used
 *  when the box is restored from storage and whenever the window is resized —
 *  a panel saved on a large monitor must not be lost on a laptop. */
function clamp(b: Box): Box {
  if (typeof window === "undefined") return b;
  const w = Math.min(b.w, window.innerWidth - MARGIN * 2);
  const h = Math.min(b.h, window.innerHeight - MARGIN * 2);
  if (b.x === null || b.y === null) return { ...b, w, h };
  return {
    w,
    h,
    x: Math.min(Math.max(b.x, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    // The top never goes negative — that is the trap this exists to prevent.
    y: Math.min(Math.max(b.y, MARGIN), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

export function useResizable(storageKey: string, initial: { w: number; h: number }) {
  const [box, setBox] = useState<Box>({ ...initial, x: null, y: null });
  const [active, setActive] = useState<Edge | null>(null);
  const start = useRef({ px: 0, py: 0, w: 0, h: 0, x: 0, y: 0 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw) as Box;
        if (typeof p?.w === "number" && typeof p?.h === "number") setBox(clamp(p));
      }
    } catch {
      /* private mode — the default size is fine */
    }
  }, [storageKey]);

  // A panel positioned on a big screen must not be stranded off a small one.
  useEffect(() => {
    const onResize = () => setBox((b) => clamp(b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const persist = useCallback(
    (next: Box) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* nothing to do */
      }
    },
    [storageKey],
  );

  const begin = useCallback(
    (edge: Edge) => (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // Never swallow a press meant for a control.
      //
      // The whole header is the drag handle, and the header also holds the
      // settings, expand and ✕ buttons. Calling preventDefault on every
      // pointerdown killed the click before it could become one — so those
      // buttons did nothing at all, which is exactly what he hit: "I can see
      // setting button but it's not working, also even the X button".
      const t = e.target as HTMLElement | null;
      if (t?.closest("button, a, input, textarea, select, [role='button']")) return;
      e.preventDefault();
      e.stopPropagation();
      const panel = e.currentTarget.closest("[data-resizable]") as HTMLElement | null;
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      start.current = { px: e.clientX, py: e.clientY, w: r.width, h: r.height, x: r.left, y: r.top };
      setActive(edge);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const move = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!active) return;
      const dx = e.clientX - start.current.px;
      const dy = e.clientY - start.current.py;
      const s = start.current;

      if (active === "move") {
        setBox((b) => clamp({ ...b, x: s.x + dx, y: s.y + dy }));
        return;
      }

      let { w, h, x, y } = { w: s.w, h: s.h, x: s.x, y: s.y };
      // Dragging a LEFT or TOP edge has to move the panel as well as resize
      // it, or the far edge walks across the screen while you pull.
      if (active.includes("e")) w = s.w + dx;
      if (active.includes("w")) { w = s.w - dx; x = s.x + dx; }
      if (active.includes("s")) h = s.h + dy;
      if (active.includes("n")) { h = s.h - dy; y = s.y + dy; }

      if (w < MIN_W) { if (active.includes("w")) x = s.x + (s.w - MIN_W); w = MIN_W; }
      if (h < MIN_H) { if (active.includes("n")) y = s.y + (s.h - MIN_H); h = MIN_H; }
      setBox(clamp({ w, h, x, y }));
    },
    [active],
  );

  const end = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!active) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      setActive(null);
      setBox((b) => {
        persist(b);
        return b;
      });
    },
    [active, persist],
  );

  const reset = useCallback(() => {
    const next: Box = { ...initial, x: null, y: null };
    setBox(next);
    persist(next);
  }, [initial, persist]);

  /** Handlers for one edge or corner. */
  const grip = useCallback(
    (edge: Edge) => ({
      onPointerDown: begin(edge),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
    }),
    [begin, move, end],
  );

  return { box, active, grip, reset, MIN_W };
}
