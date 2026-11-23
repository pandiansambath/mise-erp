// The designs of the name's area (§102.2) — HELLO I'M, his name, his role and
// company, where he is and the time.
//
//   "that left side the big font of my name… HELLO I'M… System Engineer TCS…
//    these are fine as default… I also need a feature in our PS, like some
//    extra designs for that area… animate, add effects… I need more than 5
//    designs for that area — 1 I need like adapting to the current UI, others
//    you can think"
//
// Chosen behind the PS door (owner panel → Template), saved with his words
// (`style.plate` in texts.json). Plain module: copy.ts checks the id, the panel
// lists them, Nameplate.tsx draws the one chosen.

export type PlateId = "classic" | "water" | "dust" | "forge" | "chrome" | "neon" | "drafted" | "signal" | "board" | "console";

export const PLATES: { id: PlateId; label: string; note: string }[] = [
  { id: "classic", label: "Classic", note: "As the site began: the serif with a slow light crossing it; point at it and it scrambles." },
  { id: "water", label: "The page’s water", note: "Made of this page: your name filled with the cards’ own water, crystal-edged, standing on its surface. Drops fall, it ripples, its reflection moves." },
  { id: "dust", label: "Stardust", note: "Grains off the galaxy gather into your name. Touch it: they scatter, and come home." },
  { id: "forge", label: "Forged", note: "Hammered out letter by letter, white-hot, cooling to gold; embers rise. Strike it and it glows again." },
  { id: "chrome", label: "Liquid chrome", note: "Polished metal with a whole room moving in it, and glints. It answers the cursor." },
  { id: "neon", label: "Neon sign", note: "Glass tubes that stutter on; one letter never quite steady. Pull its chain to switch it off." },
  { id: "drafted", label: "Drafted", note: "Plotted like an engineer’s drawing: outlines, guides, true measurements, a title block." },
  { id: "signal", label: "Signal", note: "A picture coming in from far away: it tears, splits its colours, and locks." },
  { id: "board", label: "Departure board", note: "Split flaps turn over until they spell you; the clock flips every second." },
  { id: "console", label: "Console", note: "Typed at a prompt: who you are, where you work, what time it is." },
];

export const isPlate = (x: unknown): x is PlateId => PLATES.some((p) => p.id === x);
