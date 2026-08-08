"use client";

// Everything the screen can do, behind one dot.
//
// The controls had been accumulating along the counter row — a theme swatch, a
// rota button, a leave button — each one added where it happened to fit. Four
// or five is the point where a row of loose buttons stops reading as "things
// you can do" and starts reading as clutter on a screen whose whole job is a
// list of names.
//
// So one ⋮ in the corner, and behind it the lot, grouped by what they are FOR:
// what to look at, how the clock reads, and how the screen looks. That is also
// the honest shape — rota and leave are content, the rest is appearance, and
// mixing them in one strip said they were the same kind of thing.

import { useEffect, useRef, type ReactNode } from "react";
import { THEMES, type ThemeKey } from "@/lib/theme";
import type { ClockFace } from "@/components/AnalogClock";

// Twelve, drawn from real traditions rather than invented variants — each is
// defined by what it REMOVES and what it makes dominant, which is how clock
// design actually differs.
const FACES: { key: ClockFace; label: string; hint: string }[] = [
  { key: "classic", label: "Classic", hint: "sixty marks" },
  { key: "minimal", label: "Minimal", hint: "quarters only" },
  { key: "roman", label: "Roman", hint: "XII I II III" },
  { key: "bold", label: "Bold", hint: "read from far" },
  { key: "braun", label: "Braun", hint: "Rams, spare" },
  { key: "railway", label: "Railway", hint: "Swiss station" },
  { key: "bauhaus", label: "Bauhaus", hint: "geometric" },
  { key: "skeleton", label: "Skeleton", hint: "hands only" },
  { key: "dots", label: "Dots", hint: "twelve points" },
  { key: "arc", label: "Arc", hint: "minute as a ring" },
  { key: "halo", label: "Halo", hint: "hour as a glow" },
  { key: "regulator", label: "Regulator", hint: "minute dominant" },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-3 first:border-t-0">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
        {title}
      </p>
      {children}
    </div>
  );
}

export function KioskMenu({
  open,
  onOpen,
  onClose,
  theme,
  onTheme,
  face,
  onFace,
  numerals,
  onNumerals,
  digital,
  onDigital,
  showRota,
  showLeave,
  onRota,
  onLeave,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  theme: ThemeKey;
  onTheme: (k: ThemeKey) => void;
  face: ClockFace;
  onFace: (f: ClockFace) => void;
  numerals: boolean;
  onNumerals: (v: boolean) => void;
  digital: boolean;
  onDigital: (v: boolean) => void;
  showRota: boolean;
  showLeave: boolean;
  onRota: () => void;
  onLeave: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const Toggle = ({
    on,
    label,
    hint,
    onChange,
  }: {
    on: boolean;
    label: string;
    hint: string;
    onChange: (v: boolean) => void;
  }) => (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fg">{label}</span>
        <span className="block text-[11px] text-fg-faint">{hint}</span>
      </span>
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={open ? onClose : onOpen}
        aria-label="Screen options"
        aria-expanded={open}
        className="mise-press grid h-11 w-11 place-items-center rounded-full border border-line-2 text-lg text-fg-soft transition hover:border-brand-400/50"
      >
        ⋮
      </button>

      {open && (
        <>
          {/* A full-screen catcher, so a tap anywhere closes it. On a wall
              tablet that is the gesture people try first. */}
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
          <div
            ref={panel}
            className="mise-pop absolute right-0 top-14 z-50 max-h-[78dvh] w-[19rem] overflow-y-auto rounded-2xl border border-line bg-paper shadow-2xl"
          >
            {(showRota || showLeave) && (
              <Group title="Look at">
                <div className="flex flex-wrap gap-2">
                  {showRota && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRota();
                      }}
                      className="mise-press mise-neo-raised flex-1 rounded-xl px-3 py-2.5 text-sm font-medium text-fg"
                    >
                      🗓️ Today&apos;s rota
                    </button>
                  )}
                  {showLeave && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onLeave();
                      }}
                      className="mise-press mise-neo-raised flex-1 rounded-xl px-3 py-2.5 text-sm font-medium text-fg"
                    >
                      🌴 Who is off
                    </button>
                  )}
                </div>
              </Group>
            )}

            <Group title="The clock">
              <div className="mise-noscrollbar grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {FACES.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => onFace(f.key)}
                    className={`mise-press rounded-xl px-3 py-2 text-left transition ${
                      face === f.key
                        ? "mise-neo-raised ring-1 ring-brand-400/60"
                        : "border border-line hover:border-line-2"
                    }`}
                  >
                    <span className="block text-[13px] font-medium text-fg">{f.label}</span>
                    <span className="block text-[10px] text-fg-faint">{f.hint}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <Toggle
                  on={numerals}
                  label="Show the numbers"
                  hint="or just double-tap the clock"
                  onChange={onNumerals}
                />
                <Toggle
                  on={digital}
                  label="Digital time on the face"
                  hint="the figure under the hands"
                  onChange={onDigital}
                />
              </div>
            </Group>

            <Group title="How it looks">
              <div className="grid grid-cols-7 gap-1.5">
                {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onTheme(k)}
                    title={THEMES[k].label}
                    aria-label={THEMES[k].label}
                    className={`grid h-8 place-items-center rounded-lg ring-1 ${
                      k === theme ? "ring-brand-400" : "ring-glass/20"
                    }`}
                    style={{ background: THEMES[k].surfaces[1] }}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ background: THEMES[k].brand["500"] }}
                    />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                This device only. The restaurant&apos;s own theme is set where the PIN is.
              </p>
            </Group>
          </div>
        </>
      )}
    </>
  );
}
