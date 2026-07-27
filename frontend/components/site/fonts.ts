// Display fonts a hotel can choose for its public site. next/font self-hosts them
// at build time (no runtime request to Google), so the picker costs nothing at load.
import { Bebas_Neue, Caveat, Fraunces, Playfair_Display } from "next/font/google";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "800"], display: "swap" });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: ["600", "700"], display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["600", "900"], display: "swap" });

export const SITE_FONTS = [
  { key: "sans", label: "Clean", className: "" },
  { key: "serif", label: "Elegant", className: playfair.className },
  { key: "poster", label: "Poster", className: bebas.className },
  { key: "editorial", label: "Editorial", className: fraunces.className },
  { key: "hand", label: "Handwritten", className: caveat.className },
] as const;

export function fontClass(key?: string): string {
  return SITE_FONTS.find((f) => f.key === key)?.className ?? "";
}
