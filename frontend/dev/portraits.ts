// His portrait photos and their pace (22 Nov): "the centre photo of me… I need
// full customisation, like I can change photo, add photos, edit time interval".
//
// Set from the owner panel and stored as dev-site/portrait.json; read by the
// page on the server and handed to every design. Kept out of the client
// modules so the server can use the defaults as values.

// …and its LOOKS (23 Nov): "different kinds of views — one is the default
// normal, like current; others, the photo can adapt to that area… the colour
// and grading… so that photo is also part of the UI". Natural is the photo as
// taken; the others grade it into the page (PortraitLooks.tsx).
export type PortraitLook = "natural" | "graded" | "water" | "duotone" | "noir";

export const PORTRAIT_LOOKS: { id: PortraitLook; label: string; hint: string }[] = [
  { id: "natural", label: "Natural", hint: "as taken" },
  { id: "graded", label: "Graded", hint: "in the theme's light and colour" },
  { id: "water", label: "Water", hint: "graded, under the cards' water" },
  { id: "duotone", label: "Duotone", hint: "printed in the theme's two colours" },
  { id: "noir", label: "Noir", hint: "black and white, a touch of the theme" },
];

export const isPortraitLook = (v: unknown): v is PortraitLook => typeof v === "string" && PORTRAIT_LOOKS.some((l) => l.id === v);

export type PortraitSet = {
  /** URLs, in his order. */
  photos: string[];
  /** Seconds each photo stays before the next crossfades in. */
  interval: number;
  /** The look visitors see first (each can pick their own). */
  look: PortraitLook;
};

/** The two photos the site always had, until he sets his own. */
export const DEFAULT_PORTRAITS: PortraitSet = {
  photos: ["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"],
  interval: 65,
  look: "natural",
};

/** Files the server will serve as portraits: the two originals and uploads. */
export const PORTRAIT_FILE = /^(?:profile(?:-alt)?\.webp|portrait\/pt-[a-f0-9]{6}\.webp)$/;
