// Display fonts a hotel can choose for its public site. next/font self-hosts them
// at build time (no runtime request to Google), so the picker costs nothing at load.
// Local — see app/layout.tsx for why the build no longer phones Google.
import localFont from "next/font/local";

const playfair = localFont({ src: "../../app/fonts/playfair.woff2", weight: "400 900", display: "swap" });
const bebas = localFont({ src: "../../app/fonts/bebas.woff2", weight: "400", display: "swap" });
const caveat = localFont({ src: "../../app/fonts/caveat.woff2", weight: "400 700", display: "swap" });
const fraunces = localFont({ src: "../../app/fonts/fraunces.woff2", weight: "100 900", display: "swap" });

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
