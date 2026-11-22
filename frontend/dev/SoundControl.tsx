"use client";

// The sound control, in the top bar.
//
//   "remove the bottom left corner 2 items, music and music menu… place
//    somewhere like the top… currently it's disturbing the view of the
//    bottom" (22 Nov)
//
// One pill in the bar: the bars mute or unmute with one tap (his "mute
// button"), the small chevron beside them opens the volume, the song that is
// playing, and skip — in a menu of the cards' glass and water. The bars dance
// while music plays and lie flat when it is muted, so the state is visible
// without reading anything.

import { useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { registerSurface } from "./CardGL";
import type { Player } from "./music";

function Menu({ player, playing, onClose }: { player: Player; playing: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const water = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = panel.current;
    const slot = water.current;
    if (!el || !slot) return;
    return registerSurface(el, slot, { radius: 16, hue: "var(--d-b)" });
  }, []);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const box = panel.current?.parentElement;
      if (box && !box.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div
      ref={panel}
      className="dev-surface absolute right-0 top-full z-50 mt-2.5 w-64 overflow-hidden rounded-2xl border border-[var(--d-line2)] shadow-2xl"
      style={{ animation: "devFadeUp .3s ease-out backwards" }}
    >
      <span ref={water} aria-hidden className="dev-glsurface" />
      <div className="relative p-4">
        <p className="font-mono text-[9px] tracking-[0.25em] text-[var(--d-a)]">NOW PLAYING · {player.mode === "album" ? "ALBUM" : "SITE"}</p>
        <p className="mt-1 truncate text-[14px] font-semibold">{player.track?.title ?? "—"}</p>
        <label className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[10px] text-[var(--d-ink5)]">VOL</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(player.volume * 100)}
            onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
            className="dev-range flex-1"
            aria-label="Volume"
          />
          <span className="w-8 text-right font-mono text-[11px] tabular-nums text-[var(--d-ink3)]">{Math.round(player.volume * 100)}</span>
        </label>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => player.setMuted(!player.muted)}
            className="dev-glassbtn flex-1 rounded-xl py-1.5 text-[12px] font-semibold text-[var(--d-ink2)] transition"
          >
            {playing ? "Mute" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => player.next()}
            disabled={player.playlist().length < 2}
            className="dev-glassbtn flex-1 rounded-xl py-1.5 text-[12px] font-semibold text-[var(--d-ink2)] transition disabled:opacity-40"
          >
            Next ⏭
          </button>
        </div>
      </div>
    </div>
  );
}

export function SoundControl({ player, style }: { player: Player | null; style?: CSSProperties }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState(false);
  useEffect(() => (player ? player.subscribe(force) : undefined), [player]);
  if (!player) return null;
  const playing = player.started && !player.muted;

  return (
    <div className="relative flex items-center" style={style}>
      <div className="dev-glassbtn flex h-9 items-center rounded-full sm:h-10">
        <button
          type="button"
          onClick={() => player.setMuted(!player.muted)}
          aria-label={playing ? "Mute music" : "Play music"}
          title={playing ? "Mute" : "Play music"}
          className="grid h-full w-9 place-items-center rounded-full transition hover:brightness-125 sm:w-10"
        >
          <span aria-hidden className="flex h-3.5 items-end gap-[2.5px]">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-[2.5px] rounded-full"
                style={{
                  background: "linear-gradient(to top, var(--d-a), var(--d-b))",
                  height: playing ? undefined : "3px",
                  animation: playing ? `devEq ${0.7 + i * 0.17}s ${i * 0.1}s ease-in-out infinite alternate` : undefined,
                }}
              />
            ))}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Sound settings"
          aria-expanded={open}
          className="grid h-full w-5 place-items-center pr-1.5 text-[10px] text-[var(--d-ink4)] transition hover:text-[var(--d-ink)] sm:w-6"
        >
          {open ? "▴" : "▾"}
        </button>
      </div>
      {open && <Menu player={player} playing={playing} onClose={() => setOpen(false)} />}
    </div>
  );
}
