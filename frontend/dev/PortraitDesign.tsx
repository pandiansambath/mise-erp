"use client";

// The portrait's photo DESIGNS (23 Nov, second pass).
//
//   "this is not what I expected… see this [the Chronicle design's halftone] —
//    you have completely changed the photo… looks unique… instead of showing
//    the original photo, edit and show… blur the edges and show the face…
//    make the outer side brighter… the complete circle photo getting adapted,
//    blurred, going to the background, and in front the skills rotating… not
//    just a filter… a complete change… unique and advanced, dude"
//
// Each design is a different way of SHOWING him, not a colour over the photo:
//   · Natural   — as taken, in its frame.
//   · Aura      — no frame: the face sharp, the edges dissolving into a glow of
//                 the photo's own colours, a brighter rim of light round it.
//   · Immersive — the photo sinks into the page: large, soft, graded, behind
//                 the orbit's rings (PortraitBackdrop), the face clear at the
//                 centre, the skills circling in front.
//   · Halftone  — a real dot-screen print: dots sized by the light, rotated
//                 45°, in the theme's colours (light dots on a dark theme).
//   · Code      — his face WRITTEN in his own skills: rows of PYTHON · AWS ·
//                 KAFKA…, each letter as bright as the face beneath it.
//   · Hologram  — projected light: a two-tone base, red and blue fringes,
//                 scanlines drifting, a band of light passing, a flicker.
// Halftone and Code are drawn once per photo, design and theme on a 2D canvas
// (no WebGL context — a phone has only a few), then shown as images.

import { useEffect, useState, type CSSProperties } from "react";
import type { PortraitLook } from "./portraits";
import { ALL_SKILLS } from "./skills";
import { readRGB } from "./theme";

type RGB = [number, number, number];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const mask = (m: string): CSSProperties => ({ WebkitMaskImage: m, maskImage: m });

const FACE = "radial-gradient(circle at 50% 46%, #000 47%, transparent 71%)";
const AURA = "radial-gradient(circle, #000 24%, transparent 70%)";
const FEATHER = "radial-gradient(circle, #000 60%, transparent 72%)";

// ── The drawn designs ─────────────────────────────────────────────────────
const drawn = new Map<string, Promise<string | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });
}

/** Halftone or Code for one photo, as an image URL (cached per theme). */
export function drawDesign(src: string, look: "halftone" | "code"): Promise<string | null> {
  const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
  const col = (r: string, fb: RGB) => readRGB(root, r, fb) as RGB;
  const pal = { bg: col("bg", [7, 10, 15]), a: col("a", [217, 119, 66]), a2: col("a2", [240, 160, 100]), b2: col("b2", [125, 240, 220]), c: col("c", [155, 140, 255]), gold: col("gold", [240, 189, 106]), ink: col("ink", [230, 237, 245]) };
  const key = [look, src, ...Object.values(pal).map((c) => c.join(","))].join("|");
  const hit = drawn.get(key);
  if (hit) return hit;
  const job = (async () => {
    try {
      const img = await loadImage(src);
      if (look === "code") await document.fonts.ready;
      const S = 460;
      // His crop: square, centred across, 30% down (the frame's object-position).
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) * 0.3;
      // A small, averaged copy to read the light from.
      const R = 150;
      const small = document.createElement("canvas");
      small.width = small.height = R;
      const sg = small.getContext("2d", { willReadFrequently: true });
      if (!sg) return null;
      sg.drawImage(img, sx, sy, side, side, 0, 0, R, R);
      const px = sg.getImageData(0, 0, R, R).data;
      // Auto-levels: the photo's own darkest and brightest (5th / 95th
      // percentile) become black and white, so the face carries the contrast.
      const all: number[] = [];
      for (let i = 0; i < px.length; i += 4) all.push((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255);
      const sorted = [...all].sort((x, y) => x - y);
      const lo = sorted[Math.floor(sorted.length * 0.05)];
      const hi = sorted[Math.floor(sorted.length * 0.95)];
      const lum = (x: number, y: number) => {
        const k = Math.min(R - 1, Math.max(0, Math.round((y / S) * R))) * R + Math.min(R - 1, Math.max(0, Math.round((x / S) * R)));
        return Math.min(1, Math.max(0, (all[k] - lo) / Math.max(0.05, hi - lo)));
      };
      const dark = (0.2126 * pal.bg[0] + 0.7152 * pal.bg[1] + 0.0722 * pal.bg[2]) / 255 < 0.5;
      const out = document.createElement("canvas");
      out.width = out.height = S;
      const o = out.getContext("2d");
      if (!o) return null;
      if (look === "halftone") {
        // A dot screen at 45°: on a dark theme light dots sized by the light,
        // on a pale one ink dots sized by the dark.
        const cell = 7.2;
        const n = Math.ceil((S * 0.75) / cell) + 2;
        const cs = Math.SQRT1_2;
        for (let j = -n; j <= n; j++) {
          for (let i = -n; i <= n; i++) {
            const u = i * cell;
            const v = j * cell;
            const x = S / 2 + (u - v) * cs;
            const y = S / 2 + (u + v) * cs;
            if (x < -cell || y < -cell || x > S + cell || y > S + cell) continue;
            const L = lum(x, y);
            const k = dark ? L : 1 - L;
            const r = cell * 0.58 * Math.sqrt(Math.max(0, k * 1.06 - 0.04));
            if (r < 0.4) continue;
            const c = dark ? mixRGB(mixRGB(pal.b2, pal.gold, y / S), [255, 255, 255], L * 0.35) : mixRGB(mixRGB(pal.ink, [10, 12, 18], 0.6), pal.a, 0.18);
            o.fillStyle = css(c);
            o.beginPath();
            o.arc(x, y, r, 0, Math.PI * 2);
            o.fill();
          }
        }
      } else {
        // His face written in his skills.
        const text = ALL_SKILLS.map((s) => s.toUpperCase()).join(" · ") + " · ";
        const probe = document.querySelector(".font-mono") as HTMLElement | null;
        const family = probe ? getComputedStyle(probe).fontFamily : "ui-monospace, monospace";
        const fh = 9.5;
        o.font = `700 ${fh}px ${family}`;
        o.textBaseline = "alphabetic";
        const cw = o.measureText("M").width;
        const rows = Math.ceil(S / fh);
        const cols = Math.ceil(S / cw);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ch = text[(r * 41 + c) % text.length];
            if (ch === " ") continue;
            const x = c * cw;
            const y = (r + 1) * fh - 2;
            const L = lum(x + cw / 2, y - fh / 2);
            // A steep curve: the lit face bright, the rest falls away.
            const e = L * L * (3 - 2 * L);
            const k = dark ? Math.pow(e, 1.8) : Math.pow(1 - e, 1.6);
            if (k < 0.04) continue;
            o.globalAlpha = Math.min(1, k * 1.15);
            o.fillStyle = css(dark ? mixRGB(pal.b2, pal.gold, L) : mixRGB([12, 14, 20], pal.a, 0.3));
            o.fillText(ch, x, y);
          }
        }
        o.globalAlpha = 1;
      }
      return out.toDataURL("image/png");
    } catch {
      return null;
    }
  })();
  drawn.set(key, job);
  return job;
}

/** The photos as one stack, the one showing crossfading at his pace. */
function Stack({ photos, active, style, hover = true, named = false }: { photos: (string | null)[]; active: number; style?: CSSProperties; hover?: boolean; named?: boolean }) {
  return (
    <>
      {photos.map((src, n) =>
        src ? (
          // eslint-disable-next-line @next/next/no-img-element -- served from the private bucket through the backend
          <img
            key={`${n}-${src.slice(-24)}`}
            src={src}
            alt={named && n === 0 ? "Pandian Sambath" : ""}
            aria-hidden={!named || n !== 0}
            draggable={false}
            className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-[1600ms] ease-out ${hover ? "group-hover:scale-[1.05]" : ""}`}
            style={{ objectPosition: "50% 30%", opacity: n === active ? 1 : 0, ...style }}
          />
        ) : null,
      )}
    </>
  );
}

/** Whether a design keeps the round frame (rim and clip) round the photo. */
export const framed = (look: PortraitLook) => look === "natural" || look === "halftone" || look === "code" || look === "hologram";

/** The photo's design, inside the portrait (the frame, if any, is the caller's). */
export function PortraitPhoto({ photos, active, look }: { photos: string[]; active: number; look: PortraitLook }) {
  // Halftone and Code: drawn for the photo showing and the next one.
  const drawnLook = look === "halftone" || look === "code" ? look : null;
  const [art, setArt] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!drawnLook || photos.length === 0) return;
    let live = true;
    const want = [photos[active % photos.length], photos[(active + 1) % photos.length]];
    for (const src of want) {
      void drawDesign(src, drawnLook).then((url) => {
        if (live && url) setArt((m) => (m[`${drawnLook}|${src}`] === url ? m : { ...m, [`${drawnLook}|${src}`]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [drawnLook, photos, active]);

  if (look === "aura") {
    return (
      <>
        {/* The glow: the photo's own colours, blurred, reaching past the frame. */}
        <span aria-hidden className="pointer-events-none absolute -inset-[40%]" style={mask(AURA)}>
          <Stack photos={photos} active={active} hover={false} style={{ filter: "blur(18px) saturate(1.7) brightness(1.2)" }} />
        </span>
        {/* The face, sharp, its edges melting into the glow. */}
        <span className="absolute inset-0" style={mask(FACE)}>
          <Stack photos={photos} active={active} named />
        </span>
        {/* A brighter rim of light round it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[16%] rounded-full mix-blend-screen"
          style={{ background: "radial-gradient(circle, transparent 49%, color-mix(in srgb, var(--d-b2) 30%, transparent) 61%, color-mix(in srgb, var(--d-a2) 12%, transparent) 68%, transparent 77%)" }}
        />
      </>
    );
  }
  if (look === "immersive") {
    // The face at the centre (the rest of him is the backdrop behind the rings).
    return (
      <span className="absolute inset-0" style={mask(FACE)}>
        <Stack photos={photos} active={active} named style={{ filter: "url(#dev-look-graded)" }} />
      </span>
    );
  }
  if (drawnLook) {
    const urls = photos.map((src) => art[`${drawnLook}|${src}`] ?? null);
    return (
      <>
        <Stack photos={urls} active={active} />
        {/* Until it is drawn: the photo, faint. */}
        {!urls[active] && <Stack photos={photos} active={active} style={{ filter: "grayscale(1) brightness(.5)" }} hover={false} />}
        <span role="img" aria-label="Pandian Sambath" className="absolute inset-0" />
        <span aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(circle, transparent 56%, color-mix(in srgb, var(--d-bg) 55%, transparent) 100%)" }} />
      </>
    );
  }
  if (look === "hologram") {
    const now = photos[active % Math.max(1, photos.length)];
    return (
      <span className="dev-holo absolute inset-0" style={mask(FEATHER)}>
        <Stack photos={photos} active={active} named style={{ filter: "url(#dev-look-duotone) contrast(1.12)" }} hover={false} />
        {now && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the private bucket through the backend */}
            <img src={now} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover mix-blend-screen" style={{ objectPosition: "50% 30%", filter: "url(#dev-holo-r)", transform: "translateX(-2px)", opacity: 0.55 }} />
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the private bucket through the backend */}
            <img src={now} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover mix-blend-screen" style={{ objectPosition: "50% 30%", filter: "url(#dev-holo-b)", transform: "translateX(2px)", opacity: 0.55 }} />
          </>
        )}
        <span aria-hidden className="dev-holo-lines pointer-events-none absolute inset-x-0 -top-full h-[200%]" />
        <span aria-hidden className="dev-holo-sweep pointer-events-none absolute inset-0" />
      </span>
    );
  }
  // Natural.
  return (
    <>
      <Stack photos={photos} active={active} named />
      <span aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,.12), transparent 55%)" }} />
    </>
  );
}

/** Immersive: him, large and soft, behind the orbit's rings. */
export function PortraitBackdrop({ photos, active }: { photos: string[]; active: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: "86cqw", height: "86cqw", zIndex: 1, opacity: 0.62, ...mask("radial-gradient(closest-side, #000 20%, rgba(0,0,0,.6) 55%, transparent 100%)") }}
    >
      <Stack photos={photos} active={active} hover={false} style={{ filter: "url(#dev-look-graded) blur(3px) saturate(1.15)" }} />
    </span>
  );
}

/** A small still of a design, for choosing one (the owner panel). */
export function DesignPreview({ src, look }: { src: string; look: PortraitLook }) {
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => {
    if (look !== "halftone" && look !== "code") return;
    let live = true;
    void drawDesign(src, look).then((u) => live && setArt(u));
    return () => {
      live = false;
    };
  }, [src, look]);
  const img = (style?: CSSProperties, s = src) => (
    // eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend
    <img src={s} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "50% 30%", ...style }} />
  );
  return (
    <span className="relative block h-full w-full overflow-hidden rounded-full bg-[var(--d-bg2)]">
      {look === "natural" && img()}
      {look === "aura" && (
        <>
          <span className="absolute -inset-[30%]" style={mask(AURA)}>{img({ filter: "blur(8px) saturate(1.6) brightness(1.2)" })}</span>
          <span className="absolute inset-0" style={mask(FACE)}>{img()}</span>
        </>
      )}
      {look === "immersive" && (
        <>
          <span className="absolute -inset-[20%] opacity-60">{img({ filter: "url(#dev-look-graded) blur(2px)" })}</span>
          <span className="absolute inset-[12%]" style={mask(FACE)}>{img({ filter: "url(#dev-look-graded)" })}</span>
        </>
      )}
      {(look === "halftone" || look === "code") && art && img(undefined, art)}
      {look === "hologram" && (
        <span className="dev-holo absolute inset-0" style={mask(FEATHER)}>
          {img({ filter: "url(#dev-look-duotone) contrast(1.12)" })}
          <span className="dev-holo-lines absolute inset-x-0 -top-full h-[200%]" />
        </span>
      )}
    </span>
  );
}
