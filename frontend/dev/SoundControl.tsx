"use client";

// The sound button, bottom-left on every design.
//
// One tap mutes or unmutes (his "mute button"); the small arrow beside it
// opens the volume, the song that is playing, and skip. The bars dance while
// music plays and lie flat when it is muted, so the state is visible without
// reading anything.

import { useEffect, useReducer, useState } from "react";
import type { Player } from "./music";

export function SoundControl({ player, entered }: { player: Player | null; entered: boolean }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState(false);
  useEffect(() => (player ? player.subscribe(force) : undefined), [player]);
  if (!player) return null;
  const playing = player.started && !player.muted;

  return (
    <div
      className="fixed bottom-4 left-4 z-[70] flex items-end gap-1.5 sm:bottom-6 sm:left-6"
      style={entered ? { animation: "devPop .6s .8s cubic-bezier(.2,1.4,.4,1) both" } : { opacity: 0 }}
    >
      <button
        type="button"
        onClick={() => player.setMuted(!player.muted)}
        aria-label={playing ? "Mute music" : "Play music"}
        title={playing ? "Mute" : "Play music"}
        className="grid h-11 w-11 place-items-center rounded-full border border-[var(--d-line2)] bg-[var(--d-bg2)]/85 shadow-[0_10px_30px_-10px_rgba(0,0,0,.6)] transition hover:-translate-y-0.5 hover:border-[var(--d-b)]"
      >
        <span aria-hidden className="flex h-4 items-end gap-[3px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full"
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
        className="grid h-7 w-7 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-bg2)]/80 text-[11px] text-[var(--d-ink4)] transition hover:text-[var(--d-ink)]"
      >
        {open ? "×" : "▴"}
      </button>
      {open && (
        <div
          className="absolute bottom-14 left-0 w-64 rounded-2xl border border-[var(--d-line2)] bg-[var(--d-bg2)]/95 p-4 shadow-2xl"
          style={{ animation: "devFadeUp .3s ease-out both" }}
        >
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
              className="flex-1 rounded-xl border border-[var(--d-line2)] py-1.5 text-[12px] font-semibold text-[var(--d-ink2)] transition hover:border-[var(--d-b)]"
            >
              {playing ? "Mute" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => player.next()}
              disabled={player.playlist().length < 2}
              className="flex-1 rounded-xl border border-[var(--d-line2)] py-1.5 text-[12px] font-semibold text-[var(--d-ink2)] transition enabled:hover:border-[var(--d-b)] disabled:opacity-40"
            >
              Next ⏭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
