// His portrait photos and their pace (22 Nov): "the centre photo of me… I need
// full customisation, like I can change photo, add photos, edit time interval".
//
// Set from the owner panel and stored as dev-site/portrait.json; read by the
// page on the server and handed to every design. Kept out of the client
// modules so the server can use the defaults as values.

// …and its DESIGNS (23 Nov): "different kinds of views — one is the default
// normal, like current; others, the photo can adapt to that area", then, after
// five colour filters: "not just a filter… a complete change… blur the edges
// and show the face… make the outer side brighter… the complete circle photo
// adapted, blurred, gone to the background, the skills rotating in front… I
// need a few designs" (PortraitDesign.tsx).
export type PortraitLook =
  | "natural"
  | "aura"
  | "immersive"
  | "halftone"
  | "code"
  | "hologram"
  // No photo: a living 3D piece in the portrait's place (PortraitCore.tsx):
  // "if I wish to remove photos… we can't leave it empty… something like the
  // realistic skeleton… super cool animated stuff… perfect detailing".
  | "star"
  | "crystal"
  | "knot"
  | "neural"
  | "blackhole";

export type PortraitLookInfo = { id: PortraitLook; label: string; hint: string; kind: "photo" | "core" };

export const PORTRAIT_LOOKS: PortraitLookInfo[] = [
  { id: "natural", label: "Natural", hint: "the photo as taken", kind: "photo" },
  { id: "aura", label: "Aura", hint: "the face sharp, the edges dissolving into a glow of its own colours", kind: "photo" },
  { id: "immersive", label: "Immersive", hint: "sunk into the page behind the orbit, the skills circling in front", kind: "photo" },
  { id: "halftone", label: "Halftone", hint: "a dot-screen print in the theme's colours", kind: "photo" },
  { id: "code", label: "Code", hint: "the face written in his own skills", kind: "photo" },
  { id: "hologram", label: "Hologram", hint: "projected light — fringes, scanlines, a flicker", kind: "photo" },
  { id: "star", label: "Star", hint: "a living star — boiling plasma, a corona, flares; the orbit its solar system", kind: "core" },
  { id: "crystal", label: "Crystal", hint: "a geode heart — iridescent shards out of dark rock, a heartbeat of light", kind: "core" },
  { id: "knot", label: "Chain knot", hint: "iridescent links tied in an endless knot, a light running round", kind: "core" },
  { id: "neural", label: "Neural", hint: "a mind of light — neurons, synapses firing", kind: "core" },
  { id: "blackhole", label: "Black hole", hint: "a horizon, a photon ring, the disc bent over the top by gravity", kind: "core" },
];

/** A look that stands in for the photo (no photo shown). */
export const isCoreLook = (l: PortraitLook) => PORTRAIT_LOOKS.find((x) => x.id === l)?.kind === "core";

export const isPortraitLook = (v: unknown): v is PortraitLook => typeof v === "string" && PORTRAIT_LOOKS.some((l) => l.id === v);

export type PortraitSet = {
  /** URLs, in his order. */
  photos: string[];
  /** Seconds each photo stays before the next crossfades in. */
  interval: number;
  /** The look visitors see first (each can pick their own). */
  look: PortraitLook;
  /** How fast his skills go round him: 1 as it is, 0 still, 2 twice as fast. */
  pace: number;
};

/** The two photos the site always had, until he sets his own. */
export const DEFAULT_PORTRAITS: PortraitSet = {
  photos: ["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"],
  interval: 65,
  look: "natural",
  pace: 1,
};

/** A pace, whatever it was said as. */
export const cleanPace = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : DEFAULT_PORTRAITS.pace);

/** Files the server will serve as portraits: the two originals and uploads. */
export const PORTRAIT_FILE = /^(?:profile(?:-alt)?\.webp|portrait\/pt-[a-f0-9]{6}\.webp)$/;
