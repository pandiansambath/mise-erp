// His portrait photos and their pace (22 Nov): "the centre photo of me… I need
// full customisation, like I can change photo, add photos, edit time interval".
//
// Set from the owner panel and stored as dev-site/portrait.json; read by the
// page on the server and handed to every design. Kept out of the client
// modules so the server can use the defaults as values.

export type PortraitSet = {
  /** URLs, in his order. */
  photos: string[];
  /** Seconds each photo stays before the next crossfades in. */
  interval: number;
};

/** The two photos the site always had, until he sets his own. */
export const DEFAULT_PORTRAITS: PortraitSet = {
  photos: ["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"],
  interval: 65,
};

/** Files the server will serve as portraits: the two originals and uploads. */
export const PORTRAIT_FILE = /^(?:profile(?:-alt)?\.webp|portrait\/pt-[a-f0-9]{6}\.webp)$/;
