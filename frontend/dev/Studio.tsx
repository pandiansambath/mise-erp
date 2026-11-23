"use client";

// The studio: every theme and every design, tried with one tap.
//
//   "have a icon using that i can change the theme of site… i like more
//    themes… i can click and see each and every theme how looks like"
//   "have a button to choose which theme and design is default"
//
// A visitor's pick is remembered on their device only. Making a pick the
// site's default — what every visitor lands on — needs his password.

import { useState } from "react";
import { useDev } from "./context";
import { Popup, type Origin } from "./Popup";
import { DESIGNS, THEMES, type DesignId, type Theme } from "./theme";

function Swatch({ t, active, onPick }: { t: Theme; active: boolean; onPick: (e: React.MouseEvent) => void }) {
  const tones = [t.a, t.b, t.c, t.d].slice(0, t.tones);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`group rounded-2xl p-1.5 text-left transition duration-300 hover:-translate-y-1 ${
        active ? "ring-2 ring-[var(--d-b)]" : "ring-1 ring-[var(--d-line)] hover:ring-[var(--d-line2)]"
      }`}
    >
      <span className="relative block h-20 overflow-hidden rounded-xl" style={{ background: t.bg }}>
        {/* A tiny page in this theme: a glow, a headline bar, a card. */}
        <span className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-60 blur-xl" style={{ background: t.a }} />
        <span className="absolute -bottom-8 -left-4 h-20 w-20 rounded-full opacity-50 blur-xl" style={{ background: t.b }} />
        <span className="absolute left-2.5 top-3 h-2 w-14 rounded-full" style={{ background: t.light ? "#141a22" : "#e6edf5" }} />
        <span className="absolute left-2.5 top-7 h-1.5 w-9 rounded-full opacity-60" style={{ background: t.light ? "#596574" : "#7d93ad" }} />
        <span
          className="absolute bottom-2.5 left-2.5 right-2.5 flex h-6 items-center gap-1 rounded-md px-1.5"
          style={{ background: t.light ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.06)", border: `1px solid ${t.light ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)"}` }}
        >
          {tones.map((c) => (
            <span key={c} className="h-3 w-3 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
          ))}
        </span>
      </span>
      <span className="mt-1.5 flex items-center justify-between px-1">
        <span className="text-[12.5px] font-semibold">{t.name}</span>
        <span className="font-mono text-[9px] tracking-[0.1em] text-[var(--d-ink5)]">{t.light ? "LIGHT" : `${t.tones} TONE`}</span>
      </span>
    </button>
  );
}

/** A thumbnail sketch of each design, drawn in the current theme. */
function Sketch({ id }: { id: DesignId }) {
  const ink = "var(--d-ink4)";
  if (id === "chain")
    return (
      <span className="relative block h-full w-full">
        <span className="absolute left-[14%] top-[24%] h-[52%] w-[34%] rounded-full border" style={{ borderColor: "var(--d-a)" }} />
        <span className="absolute left-[22%] top-[34%] h-[32%] w-[18%] rounded-full" style={{ background: "var(--d-b)" }} />
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute right-[10%] h-[18%] w-[36%] rounded-md border" style={{ top: `${14 + i * 26}%`, borderColor: ink }} />
        ))}
      </span>
    );
  if (id === "metro")
    return (
      <span className="relative block h-full w-full">
        <span className="absolute left-[8%] right-[8%] top-[46%] h-[6%] rounded-full" style={{ background: "var(--d-a)" }} />
        <span className="absolute left-[40%] right-[8%] top-[22%] h-[6%] -rotate-12 rounded-full" style={{ background: "var(--d-b)" }} />
        {[12, 34, 56, 78].map((x) => (
          <span key={x} className="absolute top-[42%] h-[14%] w-[9%] rounded-full border-2 bg-[var(--d-bg)]" style={{ left: `${x}%`, borderColor: "var(--d-ink)" }} />
        ))}
      </span>
    );
  if (id === "chronicle")
    return (
      <span className="relative block h-full w-full px-[10%] py-[10%]">
        <span className="block h-[16%] w-full rounded-sm" style={{ background: "var(--d-ink)" }} />
        <span className="mt-[6%] block h-[1px] w-full" style={{ background: ink }} />
        <span className="mt-[6%] grid h-[52%] grid-cols-3 gap-[6%]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-col gap-[10%]">
              {[0, 1, 2, 3].map((j) => (
                <span key={j} className="h-[12%] rounded-sm" style={{ background: i === 0 && j === 0 ? "var(--d-a)" : ink, opacity: 0.6 }} />
              ))}
            </span>
          ))}
        </span>
      </span>
    );
  if (id === "terminal")
    return (
      <span className="relative block h-full w-full rounded-md p-[10%] font-mono text-[8px] leading-tight" style={{ background: "color-mix(in srgb, var(--d-bg) 60%, black)" }}>
        <span style={{ color: "var(--d-b)" }}>$ whoami</span>
        <br />
        <span style={{ color: ink }}>pandian sambath</span>
        <br />
        <span style={{ color: "var(--d-b)" }}>$ ls skills/</span>
        <br />
        <span style={{ color: "var(--d-a2)" }}>aws python ai</span>
      </span>
    );
  if (id === "blueprint")
    return (
      <span
        className="relative block h-full w-full"
        style={{
          backgroundImage: "linear-gradient(color-mix(in srgb, var(--d-b) 22%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--d-b) 22%, transparent) 1px, transparent 1px)",
          backgroundSize: "10px 10px",
        }}
      >
        {[
          [10, 20],
          [56, 20],
          [33, 58],
        ].map(([x, y]) => (
          <span key={`${x}-${y}`} className="absolute h-[22%] w-[32%] rounded-sm border bg-[var(--d-bg)]" style={{ left: `${x}%`, top: `${y}%`, borderColor: "var(--d-b2)" }} />
        ))}
        <span className="absolute left-[42%] right-[24%] top-[31%] h-px" style={{ background: "var(--d-a2)" }} />
        <span className="absolute left-[50%] top-[42%] h-[16%] w-px" style={{ background: "var(--d-a2)" }} />
      </span>
    );
  if (id === "stories")
    return (
      <span className="relative flex h-full w-full items-center justify-center gap-[6%]">
        <span className="flex flex-col items-center gap-[10%]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block h-3 w-3 rounded-full p-[1.5px]" style={{ background: "conic-gradient(var(--d-a2), var(--d-b), var(--d-a2))" }} />
          ))}
        </span>
        <span className="relative block h-[84%] w-[34%] overflow-hidden rounded-md" style={{ background: "linear-gradient(160deg, color-mix(in srgb, var(--d-a) 55%, transparent), color-mix(in srgb, var(--d-b) 45%, black))" }}>
          <span className="absolute inset-x-[8%] top-[6%] flex gap-[4%]">
            {[1, 1, 0, 0].map((on, i) => (
              <span key={i} className="h-[2px] flex-1 rounded-full" style={{ background: on ? "white" : "rgba(255,255,255,.35)" }} />
            ))}
          </span>
          <span className="absolute bottom-[12%] left-[10%] h-[8%] w-[62%] rounded-sm bg-white/85" />
        </span>
      </span>
    );
  if (id === "ember")
    return (
      <span className="relative block h-full w-full overflow-hidden rounded-md" style={{ background: "radial-gradient(70% 70% at 0% 100%, color-mix(in srgb, var(--d-b) 30%, transparent), transparent 70%), #06080a" }}>
        <span className="absolute left-1/2 top-[22%] h-[56%] w-[26%] -translate-x-1/2 rounded-full border-[3px]" style={{ borderColor: "color-mix(in srgb, var(--d-c) 70%, white)" }} />
        {[[18, 70], [30, 58], [64, 74], [78, 52], [52, 84], [40, 40]].map(([x, y]) => (
          <span key={`${x}-${y}`} className="absolute h-[3px] w-[3px] rounded-full" style={{ left: `${x}%`, top: `${y}%`, background: "var(--d-a2)" }} />
        ))}
      </span>
    );
  return (
    <span className="grid h-full w-full grid-cols-3 grid-rows-2 gap-[5%] p-[8%]">
      <span className="col-span-2 row-span-2 rounded-md" style={{ background: "color-mix(in srgb, var(--d-a) 40%, transparent)" }} />
      <span className="rounded-md" style={{ background: "color-mix(in srgb, var(--d-b) 40%, transparent)" }} />
      <span className="rounded-md" style={{ background: "color-mix(in srgb, var(--d-c) 40%, transparent)" }} />
    </span>
  );
}

export function Studio({ origin, onClose }: { origin: Origin; onClose: () => void }) {
  const { themeId, designId, setTheme, setDesign } = useDev();
  const [tab, setTab] = useState<"themes" | "designs">("themes");
  const at = (e: React.MouseEvent) => ({ x: e.clientX, y: e.clientY });

  return (
    <Popup label="Themes and designs" origin={origin} onClose={onClose} wide>
      <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">STUDIO</p>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">Make it yours</h2>
      <p className="mt-1 text-[13px] text-[var(--d-ink3)] [text-shadow:0_1px_8px_var(--d-bg),0_0_2px_var(--d-bg)]">
        {THEMES.length} themes × {DESIGNS.length} designs. Your pick is remembered on this device.
      </p>

      <div className="mt-5 inline-flex rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] p-1">
        {(["themes", "designs"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize transition ${
              tab === k ? "text-[var(--d-on)]" : "text-[var(--d-ink4)] hover:text-[var(--d-ink)]"
            }`}
            style={tab === k ? { background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" } : undefined}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === "themes" ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" style={{ animation: "devFadeUp .4s ease-out both" }}>
          {THEMES.map((t) => (
            <Swatch key={t.id} t={t} active={t.id === themeId} onPick={(e) => setTheme(t.id, at(e))} />
          ))}
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2" style={{ animation: "devFadeUp .4s ease-out both" }}>
          {DESIGNS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={(e) => {
                setDesign(d.id, at(e));
              }}
              aria-pressed={d.id === designId}
              className={`flex gap-3 rounded-2xl p-2.5 text-left transition duration-300 hover:-translate-y-0.5 ${
                d.id === designId ? "ring-2 ring-[var(--d-b)]" : "ring-1 ring-[var(--d-line)] hover:ring-[var(--d-line2)]"
              }`}
            >
              <span className="block h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-[var(--d-line)] bg-[var(--d-bg)]">
                <Sketch id={d.id} />
              </span>
              <span className="min-w-0 py-0.5">
                <span className="block text-[14px] font-semibold">{d.name}</span>
                <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--d-b)]">{d.slogan}</span>
                <span className="mt-1 block text-[12px] leading-snug text-[var(--d-ink4)]">{d.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}

    </Popup>
  );
}
