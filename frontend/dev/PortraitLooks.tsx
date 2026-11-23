"use client";

// The portrait's looks (23 Nov).
//
//   "see this left side, my photo… I'm expecting one feature like… different
//    kinds of views: one is the default normal, like current; others are like
//    the photo can adapt to that area… the current photo is not adapted, just
//    placed like that, I mean the colour and grading… have a cool feature with
//    more and more adaptation, transition, grading… to feel like that photo is
//    also part of the UI/UX, matching"
//
// Natural is the photo as taken. The others grade it INTO the page, in the
// theme's own colours, read live (a theme change regrades it):
//   · Graded  — a tritone grade (shadows in the theme's depth, highlights in
//               its warm light) laid over the photo's own colour, so it keeps
//               its skin and gains the room's light;
//   · Water   — under the cards' water: a cool, submerged grade in the
//               theme's teal and violet, the water's light over him;
//   · Duotone — printed in the theme's two colours;
//   · Noir    — black and white, contrast up, the shadows tinted by the theme.
// Each is an SVG colour filter (a gradient map: desaturate, then a table per
// channel) — the photo is still, so it is worked out once, not per frame. The
// filters live once on the page; anything can use them by id.

import { useEffect, useState } from "react";
import type { PortraitLook } from "./portraits";
import { readRGB, THEME_EVENT } from "./theme";

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [255, 255, 255];
/** One channel of a gradient map's stops, for an feFunc table. */
const table = (stops: RGB[], ch: number) => stops.map((s) => (Math.min(255, Math.max(0, s[ch])) / 255).toFixed(3)).join(" ");

/** The CSS filter for a look (Water is Graded with the water laid on top). */
export function lookFilter(look: PortraitLook): string {
  if (look === "natural") return "none";
  return `url(#dev-look-${look})`;
}

function Map3({ id, stops, amount, contrast = 1 }: { id: string; stops: RGB[]; amount: number; contrast?: number }) {
  const slope = contrast;
  const intercept = (1 - contrast) / 2;
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="grey" />
      <feComponentTransfer in="grey" result="tone">
        <feFuncR type="linear" slope={slope} intercept={intercept} />
        <feFuncG type="linear" slope={slope} intercept={intercept} />
        <feFuncB type="linear" slope={slope} intercept={intercept} />
      </feComponentTransfer>
      <feComponentTransfer in="tone" result="mapped">
        <feFuncR type="table" tableValues={table(stops, 0)} />
        <feFuncG type="table" tableValues={table(stops, 1)} />
        <feFuncB type="table" tableValues={table(stops, 2)} />
      </feComponentTransfer>
      {/* The grade over the photo's own colour: `amount` of the map. */}
      <feComposite in="mapped" in2="SourceGraphic" operator="arithmetic" k1="0" k2={amount} k3={1 - amount} k4="0" />
    </filter>
  );
}

/** The looks' filters, in the theme's colours. Rendered once, inside .dev-root. */
export function PortraitLookDefs() {
  const [c, setC] = useState<Record<string, RGB> | null>(null);
  useEffect(() => {
    const read = () => {
      const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
      const r = (role: string, fb: RGB) => readRGB(root, role, fb) as RGB;
      setC({
        bg: r("bg", [7, 10, 15]),
        bg2: r("bg2", [11, 17, 24]),
        a: r("a", [217, 119, 66]),
        a2: r("a2", [240, 160, 100]),
        b: r("b", [45, 212, 191]),
        b2: r("b2", [125, 240, 220]),
        c: r("c", [155, 140, 255]),
        gold: r("gold", [240, 189, 106]),
      });
    };
    read();
    const onTheme = () => window.setTimeout(read, 140);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);
  if (!c) return null;
  const light = (0.2126 * c.bg[0] + 0.7152 * c.bg[1] + 0.0722 * c.bg[2]) / 255 > 0.5;
  // Graded: deep shadows from the theme's ground and its cool colour, a warm
  // light from its gold — the room's light on him.
  const deep = light ? mix(c.a, [40, 40, 50], 0.55) : mix(mix(c.bg2, c.c, 0.4), [0, 0, 0], 0.15);
  const mid = mix(mix(c.b, c.a, 0.5), [128, 128, 128], 0.45);
  const warm = mix(c.gold, WHITE, 0.5);
  // Duotone: the theme's depth to its bright accent.
  const duoDark = light ? mix(c.a, [20, 20, 30], 0.5) : mix(c.bg2, c.c, 0.55);
  const duoLight = light ? mix(c.b, WHITE, 0.55) : mix(c.b2, WHITE, 0.15);
  // Water: submerged — deep violet shadows, teal mids, a pale aqua light.
  const subDeep = light ? mix(c.c, [20, 24, 40], 0.5) : mix(c.bg2, c.c, 0.6);
  const subMid = mix(c.b, [110, 120, 130], 0.35);
  const subLight = mix(c.b2, WHITE, 0.45);
  // Noir: a touch of the theme in the shadows only.
  const noirDark = mix([8, 8, 10], c.c, 0.18);
  return (
    <svg aria-hidden focusable="false" width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <Map3 id="dev-look-graded" stops={[deep, mid, warm]} amount={0.62} contrast={1.1} />
        <Map3 id="dev-look-water" stops={[subDeep, subMid, subLight]} amount={0.66} contrast={1.06} />
        <Map3 id="dev-look-duotone" stops={[duoDark, duoLight]} amount={0.94} contrast={1.12} />
        <Map3 id="dev-look-noir" stops={[noirDark, [128, 128, 132], [250, 248, 244]]} amount={0.96} contrast={1.3} />
      </defs>
    </svg>
  );
}
