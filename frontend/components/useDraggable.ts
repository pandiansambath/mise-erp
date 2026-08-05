"use client";

// Let the user move something out of the way.
//
// The assistant launcher is fixed to one corner, and on a busy screen that
// corner is sometimes exactly where the thing you need is — his words: "our
// bubble ai dot is hiding some important thing in important areas".
//
// The whole design problem is one sentence: **a tap must open it and a drag
// must move it, and the user should not have to tell us which they meant.**
// So there is no long-press, no drag handle, no mode. You touch it and move —
// it moves. You touch it and let go — it opens. The rule is distance: past a
// few pixels it is a drag, under that it is a tap. Every native OS does the
// same thing, which is why nobody has to be taught it.
//
// Pointer events, not mouse+touch: one code path for finger, mouse and stylus.
// Position is kept per-origin so it survives a reload — moving it once should
// mean moving it once.

import { useCallback, useEffect, useRef, useState } from "react";

export type Point = { x: number; y: number };

/** Past this many pixels the gesture is a drag, and the click is suppressed. */
const SLOP = 6;

export function useDraggable(storageKey: string) {
  // null = "wherever CSS puts it". We do not invent a default position; the
  // stylesheet's corner is correct until the user says otherwise.
  const [pos, setPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const start = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw) as Point;
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(p);
      }
    } catch {
      /* private mode — the corner default is fine */
    }
  }, [storageKey]);

  // Keep it on screen. A phone rotated to landscape, or a desktop window made
  // narrow, could otherwise strand the button somewhere unreachable — and a
  // control you cannot reach is worse than one in an awkward corner.
  const clamp = useCallback((p: Point): Point => {
    const pad = 8;
    const size = 64; // generous: covers the launcher at its largest
    return {
      x: Math.min(Math.max(p.x, pad), Math.max(pad, window.innerWidth - size - pad)),
      y: Math.min(Math.max(p.y, pad), Math.max(pad, window.innerHeight - size - pad)),
    };
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, clamp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Ignore right-click and anything that is not a primary press.
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      origin.current = { x: rect.left, y: rect.top };
      start.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
      // Capture so the gesture survives the pointer leaving the element —
      // without it a quick flick drops the drag halfway.
      el.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (!moved.current && Math.hypot(dx, dy) < SLOP) return;
      if (!moved.current) {
        moved.current = true;
        setDragging(true);
      }
      setPos(clamp({ x: origin.current.x + dx, y: origin.current.y + dy }));
    },
    [clamp],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (moved.current) {
        setDragging(false);
        setPos((p) => {
          if (p) {
            try {
              localStorage.setItem(storageKey, JSON.stringify(p));
            } catch {
              /* nothing to do */
            }
          }
          return p;
        });
      }
    },
    [storageKey],
  );

  /** Call from onClick. Returns true when the click should be IGNORED because
   *  the gesture was really a drag. */
  const wasDrag = useCallback(() => {
    if (!moved.current) return false;
    moved.current = false;
    return true;
  }, []);

  return {
    pos,
    dragging,
    wasDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    /** Inline style pinning it where the user left it. */
    style: pos
      ? ({ left: pos.x, top: pos.y, right: "auto", bottom: "auto" } as const)
      : undefined,
  };
}
