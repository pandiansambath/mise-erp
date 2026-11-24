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
  /** Shown plainly, without the room. */
  plain?: boolean;
  words?: { strike: string; again: string; breaking: string; coinLink: string; coinHint: string };
};

export function AwardStage({ onOpened, onReady, onProgress, onAwake, plain = false, words }: AwardProps) {
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
      mine?.dispose();
      room.current = null;
      unclaim();
    };
    // (The callbacks are the page's own and do not change what is built.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plain]);

  if (medal) return <Medal />;

  const href = words?.coinLink && /^https?:\/\//i.test(words.coinLink) ? words.coinLink : null;
  return (
    <div
      className="absolute inset-0"
      onPointerMove={(e) => {
        if (ready) room.current?.point(...at(e), e.pointerType !== "mouse");
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
          blow(...p);
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
          aria-label={`${words?.coinHint || "The coin"}: ${href.replace(/^https?:\/\/(www\.)?/i, "")}`}
          data-coin-link
          onPointerEnter={() => room.current?.hold(true)}
          onPointerLeave={() => room.current?.hold(false)}
          onFocus={() => room.current?.hold(true)}
          onBlur={() => room.current?.hold(false)}
          className="absolute left-0 top-0 block rounded-full outline-offset-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f2c765]"
          style={{ visibility: "hidden" }}
        >
          {words?.coinHint && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full mt-7 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#e0a95c]/35 bg-[#0b0704]/70 px-3.5 py-1.5 text-[10px] tracking-[0.32em] text-[#ffe2a6]"
              style={{ animation: "devFadeUp 1s .8s ease-out both" }}
            >
              {words.coinHint} ↗
            </span>
          )}
        </a>
      )}
      {ready && !done && (
        <p className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-[11px] tracking-[0.34em] text-[#e0a95c] sm:bottom-28">
          {hits === 0 ? (words?.strike ?? "STRIKE THE CHEST") : hits < 2 ? (words?.again ?? "AGAIN") : (words?.breaking ?? "IT IS BREAKING…")}
        </p>
      )}
    </div>
  );
}
