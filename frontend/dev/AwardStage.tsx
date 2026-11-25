"use client";

// The award, on its own screen: a chest in a dark temple hall, a light where you
// point. Hit it until it breaks, and his gold coin is inside; touch the coin and it
// takes you where he chose (the Template). The scene itself is awardRoom.ts; this
// puts it on the page and passes it your pointer.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CoinBox, Room } from "./awardRoom";
import { takeAward } from "./awardDoor";
import { primeSounds, unlockSound } from "./chestBits";
import { freshPage, isMissingCode } from "./chunks";
import { did, hasDone } from "./did";
import { claimContext } from "./glGuard";
import { Medal } from "./Medal";

// How many times in a row this tab has begun building the room without being
// seen to finish: a browser killed on the way leaves its mark here.
const TRIES = "pandi-dev-award-tries";
function attempt(): number {
  try {
    const n = Number(sessionStorage.getItem(TRIES) ?? 0) + 1;
    sessionStorage.setItem(TRIES, String(n));
    return n;
  } catch {
    return 1;
  }
}
function settled() {
  try {
    sessionStorage.removeItem(TRIES);
  } catch {
    /* nothing was kept */
  }
}

export type AwardProps = {
  onOpened?: () => void;
  /** The room (or the medal in its place) is on the page: the doors may open. */
  onReady?: () => void;
  /** How much of it has come, 0–1: the light in the doors' crack. */
  onProgress?: (p: number) => void;
  /** All four lamps lit: the carvings awake. */
  onAwake?: () => void;
  /** The verse in the wall, touched. */
  onVerse?: () => void;
  /** How far down the words at the top reach (CSS px). */
  under?: number;
  /** Shown plainly, without the room. */
  plain?: boolean;
  /** Its leaves have been read (no line beckons to them any more). */
  read?: boolean;
  words?: { strike: string; again: string; breaking: string; coinLink: string; coinSays?: string; light?: string; lamps?: string; lampsLeft?: string; awake?: string; kuralOne?: string; kuralTwo?: string; kuralAfter?: string };
};

export function AwardStage({ onOpened, onReady, onProgress, onAwake, onVerse, under = 0, plain = false, read = false, words }: AwardProps) {
  const mount = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const room = useRef<Room | null>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  // Nothing is shown until the whole scene is ready — chest, coin, light — and
  // drawn once. Blows before that are ignored, not queued.
  const [ready, setReady] = useState(false);
  // WebGL can be missing or blocked (Brave's shields can do this): then the medal
  // is shown without the chest, rather than an empty room.
  const [noGL, setNoGL] = useState(false);
  const last = useRef(0);
  const medal = noGL || plain;
  // A press on the verse (opened when it is let go there), and one on the coin.
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const pulled = useRef<{ id: number; x: number; y: number; from: number; moved: boolean } | null>(null);
  // The coin, held still under the hand: in a moment it comes closer, to be read (§107.3).
  const nearing = useRef(0);
  const held = useRef(false);
  const closer = (after: number, finger: boolean) => {
    window.clearTimeout(nearing.current);
    if (finger) room.current?.hold(true);
    nearing.current = window.setTimeout(() => {
      if (finger) held.current = true;
      room.current?.hold(true, true);
    }, after);
  };
  useEffect(() => {
    room.current?.under(under);
  }, [under, ready]);

  // ── the voice at the foot (§107.4): the light one carries, the lamps that catch from it, the
  // chest; and whatever is told by the wall ──
  const [lit, setLit] = useState(0);
  const [tells, setTells] = useState(false);
  const [voice, setVoice] = useState<"" | "light" | "lamps" | "left" | "awake">("");
  const [late, setLate] = useState(false);
  const feet = useRef<(HTMLButtonElement | null)[]>([]);
  const way = useRef({ x: 0, y: 0, far: 0 });
  useEffect(() => {
    if (!ready || hasDone("lamps")) return;
    const a = window.setTimeout(() => setVoice((v) => (v || way.current.far > 240 ? v || "lamps" : "light")), 3400);
    const b = window.setTimeout(() => setVoice((v) => (v === "light" ? "lamps" : v)), 9600);
    const c = window.setTimeout(() => setVoice((v) => (v === "lamps" ? "" : v)), 17000);
    return () => [a, b, c].forEach((x) => window.clearTimeout(x));
  }, [ready]);
  useEffect(() => {
    if (!lit) return;
    const a = window.setTimeout(() => {
      if (lit >= 4) did("lamps");
      setVoice(lit >= 4 ? "awake" : "left");
    }, 0);
    const b = window.setTimeout(() => setVoice(""), 4200);
    return () => [a, b].forEach((x) => window.clearTimeout(x));
  }, [lit]);
  const moved = (e: { clientX: number; clientY: number }) => {
    const w = way.current;
    if (w.x || w.y) w.far += Math.hypot(e.clientX - w.x, e.clientY - w.y);
    w.x = e.clientX;
    w.y = e.clientY;
    if (w.far > 240 && voice === "light") setVoice("lamps");
  };
  // Once it is open, by the Kural: after the coin has come.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setLate(true), 5200);
    return () => window.clearTimeout(t);
  }, [done]);
  // (Read already, nobody beckons.)
  useEffect(() => {
    room.current?.beckon(!read);
  }, [read, ready]);

  // Told AFTER the render that opened it.
  useEffect(() => {
    if (done || medal) onOpened?.();
  }, [done, medal, onOpened]);
  useEffect(() => {
    if (ready || medal) onReady?.();
  }, [ready, medal, onReady]);

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = mount.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  };
  const blow = useCallback(
    (nx?: number, ny?: number) => {
      if (done || !ready) return;
      unlockSound(); // the gesture browsers require; the audio is already decoded
      const now = performance.now();
      const gap = now - last.current;
      const power = gap < 300 ? 1.7 : gap < 650 ? 1.25 : 1;
      // The hammer lands where the tap did (if the tap was anywhere near the chest).
      if (room.current?.hit(power, nx, ny) !== "hit") return;
      last.current = now;
      setHits((h) => {
        const next = h + power;
        if (next >= 3.4) setDone(true);
        return next;
      });
    },
    [done, ready],
  );

  // Fetch and decode the audio the moment the scene mounts, so the first blow plays
  // from memory. Arriving from the profile page by a click, the page already has the
  // user's gesture, so the audio can wake now rather than on the first blow.
  useEffect(() => {
    void primeSounds();
    unlockSound();
  }, []);

  useEffect(() => {
    if (plain) return;
    let alive = true;
    let mine: Room | null = null;
    // Its context is claimed first, so the card pool makes room (a phone).
    const unclaim = claimContext();
    // A phone whose browser dies building the room comes back to this page: the
    // second time the room is built lighter, the third it is the medal.
    const tries = attempt();
    const give = () => {
      if (!alive) return;
      mine?.dispose();
      mine = room.current = null;
      setNoGL(true);
    };
    if (tries > 2) {
      settled();
      unclaim();
      const t = window.setTimeout(() => setNoGL(true), 0);
      return () => window.clearTimeout(t);
    }
    performance.mark("award-stage");
    (async () => {
      const ahead = tries > 1 ? null : await takeAward();
      if (!alive) {
        ahead?.dispose();
        return;
      }
      performance.mark(ahead ? "award-ahead" : "award-build");
      if (ahead) mine = ahead;
      else {
        // A frame or two for the pool to give a canvas back.
        await new Promise((r) => setTimeout(r, 60));
        const { buildRoom } = await import("./awardRoom");
        mine = await buildRoom({
          lite: tries > 1,
          calm: () => new Promise((r) => setTimeout(r, 0)),
          alive: () => alive,
          progress: (p) => {
            performance.mark(`award-${Math.round(p * 100)}`);
            onProgress?.(p);
          },
        });
        if (!alive) {
          mine.dispose();
          return;
        }
      }
      onProgress?.(1);
      room.current = mine;
      if (!mount.current) return;
      mine.attach(mount.current, {
        ready: () => {
          if (!alive) return;
          setReady(true);
          // Up, and still up a few seconds on: this phone can.
          window.setTimeout(() => alive && settled(), 4000);
        },
        lost: give,
        awake: () => onAwake?.(),
        close: (on) => mount.current?.closest("main")?.toggleAttribute("data-near", on),
        lamp: (n) => setLit(n),
        told: (on) => setTells(on),
        panels: (at) =>
          at.forEach((p, i) => {
            const el = feet.current[i];
            if (el) el.style.transform = `translate(-50%, 0) translate(${p.x.toFixed(1)}px, ${(p.y + 14).toFixed(1)}px)`;
          }),
        coin: (c: CoinBox) => {
          const a = link.current;
          if (!a) return;
          a.style.visibility = c.on ? "visible" : "hidden";
          a.style.width = a.style.height = `${(c.r * 2).toFixed(1)}px`;
          a.style.transform = `translate(${(c.x - c.r).toFixed(1)}px, ${(c.y - c.r).toFixed(1)}px)`;
        },
      });
    })().catch((e) => {
      // Code that is no longer there (a deploy under an open page): the page comes
      // afresh, once. Anything else, on whatever phone: the medal, never an empty room.
      if (alive && isMissingCode(e) && freshPage()) return;
      give();
    });
    return () => {
      alive = false;
      settled();
      window.clearTimeout(nearing.current);
      mine?.dispose();
      room.current = null;
      unclaim();
    };
    // (The callbacks are the page's own and do not change what is built.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plain]);

  if (medal) return <Medal />;

  const left = (words?.lampsLeft ?? "").split(",").map((x) => x.trim());
  const told = [words?.kuralOne, words?.kuralTwo].filter(Boolean).join(" · ");
  const said =
    hits > 0
      ? hits < 2
        ? (words?.again ?? "AGAIN")
        : (words?.breaking ?? "IT IS GIVING WAY…")
      : (tells && !read && told) ||
        (voice === "light" && words?.light) ||
        (voice === "lamps" && words?.lamps) ||
        (voice === "left" && left[lit - 1]) ||
        (voice === "awake" && words?.awake) ||
        (words?.strike ?? "STRIKE THE CHEST");

  const href = words?.coinLink && /^https?:\/\//i.test(words.coinLink) ? words.coinLink : null;
  return (
    <div
      className="absolute inset-0"
      onPointerMove={(e) => {
        if (!ready) return;
        moved(e);
        const p = at(e);
        room.current?.point(...p, e.pointerType !== "mouse");
        // Over the verse: it can be read.
        if (e.pointerType === "mouse" && mount.current) mount.current.style.cursor = onVerse && room.current?.onVerse(...p) ? "pointer" : "";
      }}
    >
      <div
        ref={mount}
        role="button"
        tabIndex={0}
        aria-label="Strike the chest"
        onPointerDown={(e) => {
          if (!ready || e.button !== 0) return;
          const p = at(e);
          room.current?.point(...p, e.pointerType !== "mouse");
          if (onVerse && room.current?.onVerse(...p)) {
            press.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
            return;
          }
          blow(...p);
        }}
        onPointerUp={(e) => {
          const was = press.current;
          press.current = null;
          if (was && Math.hypot(e.clientX - was.x, e.clientY - was.y) < 12 && e.timeStamp - was.t < 900) onVerse?.();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          blow();
        }}
        className={`h-full w-full touch-none outline-none ${done ? "" : "cursor-[url(/dev/hammer.svg)_18_18,pointer]"}`}
      />
      {/* Over the coin, once it has come to you. */}
      {done && href && (
        <a
          ref={link}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={words?.coinSays || `The coin: ${href.replace(/^https?:\/\/(www\.)?/i, "")}`}
          title={words?.coinSays || undefined}
          data-coin-link
          // Pulled, by the mouse or a finger, it turns; a click still takes you there.
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            pulled.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: Math.max(40, e.currentTarget.offsetWidth / 2), moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
            // A finger kept on it: it comes closer, to be read (and is no tap when it is let go).
            if (e.pointerType !== "mouse") closer(340, true);
          }}
          onPointerMove={(e) => {
            const d = pulled.current;
            if (!d || d.id !== e.pointerId) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.moved) {
              if (Math.hypot(dx, dy) < 6) return;
              d.moved = true;
              if (!held.current) window.clearTimeout(nearing.current);
              e.currentTarget.style.cursor = "grabbing";
              room.current?.turn("take");
            }
            d.x = e.clientX;
            d.y = e.clientY;
            room.current?.turn("move", (dx / d.from) * 1.25, (dy / d.from) * 1.25);
          }}
          onPointerUp={(e) => {
            if (pulled.current?.moved) room.current?.turn("let");
            if (e.pointerType !== "mouse") {
              window.clearTimeout(nearing.current);
              if (held.current && pulled.current) pulled.current.moved = true;
              held.current = false;
              room.current?.hold(false);
            }
            e.currentTarget.style.cursor = "";
            // (Told once the click that follows has been.)
            window.setTimeout(() => (pulled.current = null), 0);
          }}
          onPointerCancel={() => {
            if (pulled.current?.moved) room.current?.turn("let");
            window.clearTimeout(nearing.current);
            held.current = false;
            room.current?.hold(false);
            pulled.current = null;
          }}
          onClick={(e) => {
            if (pulled.current?.moved) e.preventDefault();
          }}
          onKeyDown={(e) => {
            const by: Record<string, [number, number]> = { ArrowLeft: [-0.4, 0], ArrowRight: [0.4, 0], ArrowUp: [0, -0.4], ArrowDown: [0, 0.4] };
            const d = by[e.key];
            if (!d) return;
            e.preventDefault();
            room.current?.turn("take");
            room.current?.turn("move", ...d);
            room.current?.turn("let");
          }}
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            room.current?.hold(true);
            closer(650, false);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            window.clearTimeout(nearing.current);
            room.current?.hold(false);
          }}
          onFocus={() => room.current?.hold(true)}
          onBlur={() => room.current?.hold(false)}
          className="absolute left-0 top-0 block cursor-grab touch-none select-none rounded-full outline-offset-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f2c765]"
          style={{ visibility: "hidden" }}
        />
      )}
      {ready && !done && (
        <p key={said} className="award-voice pointer-events-none absolute inset-x-0 bottom-24 px-6 text-center sm:bottom-28">
          {said}
        </p>
      )}
      {/* By the Kural, once the room is awake: its two halves, one under each panel (a desktop). */}
      {done && late && onVerse && (
        <div className="hidden lg:block">
          {[read ? words?.kuralAfter : words?.kuralOne, read ? "" : words?.kuralTwo].map(
            (line, i) =>
              line && (
                <button
                  key={`${i}-${line}`}
                  ref={(el) => {
                    feet.current[i] = el;
                  }}
                  type="button"
                  onClick={onVerse}
                  className="award-line absolute left-0 top-0"
                >
                  <span>{line}</span>
                </button>
              ),
          )}
        </div>
      )}
    </div>
  );
}
