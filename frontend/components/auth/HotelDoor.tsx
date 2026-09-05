"use client";

// THE HOTEL'S OWN STAFF DOOR.
//
//   "actually i want thinking like why cant we give a specialised customisable
//    login page for subdomain of hotel... let them design the page in setting
//    like we did for hotel's customisable landing page. (as of now we're
//    showing the same login page of dine ai — no need this) create a super
//    special login page (with no register button) and this can be
//    customisable... have as much as feature, animation, UI ux, designs so many
//    that the super admin can customise."
//
// This is a different job from the landing page and it deserves its own
// vocabulary. The landing page sells to a diner who has never been here. This
// is the first thing a chef sees at 6am, every shift, for years — so it wants
// to feel like THEIR place, load instantly, and get out of the way.
//
// It shares the landing page's palettes, themes and fonts on purpose: one hotel
// should not have to pick their brand colour twice, and two design systems in
// one product is how a product stops looking like one product.
//
// Everything here is chrome. The actual sign-in form is passed in as `children`
// and is the same audited component on every door — customisation must never
// reach the part that handles a password.

import { useCallback, type CSSProperties, type ReactNode } from "react";

export type LoginConfig = {
  /** Off = the standard DineAI door. Empty config must change nothing. */
  enabled?: boolean;
  headline?: string;
  subline?: string;
  /** Where the form sits. */
  layout?: "split" | "centre" | "card";
  /** The moving part. "none" is a real choice, not a fallback — a kitchen
   *  tablet on bad wifi should be able to turn the weather off. */
  effect?: "aurora" | "glow" | "grid" | "spotlight" | "none";
  accent?: string;
  accent2?: string;
  theme?: "dark" | "light" | "warm";
  font?: string;
  /** Photographic mood behind the panel, from the landing page's set. */
  hero?: string;
  show_logo?: boolean;
  /** A line at the foot of the door — "Staff only · lost your password? ask Sam". */
  footer?: string;
  /** Rounded like a card, or edge to edge. */
  corners?: "soft" | "sharp";
};

export const LOGIN_LAYOUTS = [
  { key: "split", label: "Split", hint: "art one side, form the other" },
  { key: "centre", label: "Centred", hint: "form in the middle, art behind" },
  { key: "card", label: "Card", hint: "a small panel on a plain ground" },
] as const;

export const LOGIN_EFFECTS = [
  { key: "aurora", label: "Aurora", hint: "slow drifting light" },
  { key: "glow", label: "Ember", hint: "a warm pulse behind the form" },
  { key: "grid", label: "Grid", hint: "quiet architectural lines" },
  { key: "spotlight", label: "Spotlight", hint: "light follows the cursor" },
  { key: "none", label: "Still", hint: "nothing moves — kindest on old tablets" },
] as const;

export const DEFAULT_LOGIN: Required<LoginConfig> = {
  enabled: false,
  headline: "",
  subline: "",
  layout: "split",
  effect: "aurora",
  accent: "#4f46e5",
  accent2: "#0ea5e9",
  theme: "dark",
  font: "",
  hero: "warm",
  show_logo: true,
  footer: "",
  corners: "soft",
};

const THEME_INK: Record<string, { bg: string; fg: string; soft: string; panel: string; line: string }> = {
  dark: {
    bg: "#070b12",
    fg: "#f8fafc",
    soft: "rgba(248,250,252,0.72)",
    panel: "rgba(9,14,24,0.72)",
    line: "rgba(255,255,255,0.14)",
  },
  light: {
    bg: "#f6f7fb",
    fg: "#0f172a",
    soft: "rgba(15,23,42,0.68)",
    panel: "rgba(255,255,255,0.86)",
    line: "rgba(15,23,42,0.12)",
  },
  warm: {
    bg: "#1c140f",
    fg: "#fdf6ec",
    soft: "rgba(253,246,236,0.74)",
    panel: "rgba(28,20,15,0.74)",
    line: "rgba(253,246,236,0.16)",
  },
};

/** Photographic mood, as a gradient rather than a download.
 *
 *  Deliberately NOT a photo: this page is on the critical path of every shift,
 *  and a hero image is the slowest thing you can put in front of someone who
 *  just wants to clock in. The mood is carried by light instead. */
const HERO_WASH: Record<string, string> = {
  warm: "radial-gradient(120% 90% at 20% 10%, rgba(251,191,36,0.30), transparent 60%)",
  fine: "radial-gradient(120% 90% at 80% 0%, rgba(148,163,184,0.28), transparent 62%)",
  rustic: "radial-gradient(120% 90% at 15% 85%, rgba(180,83,9,0.32), transparent 60%)",
  spice: "radial-gradient(120% 90% at 85% 20%, rgba(220,38,38,0.30), transparent 60%)",
  cafe: "radial-gradient(120% 90% at 30% 15%, rgba(56,189,248,0.26), transparent 60%)",
  night: "radial-gradient(120% 90% at 50% 0%, rgba(79,70,229,0.34), transparent 64%)",
};

export function HotelDoor({
  cfg,
  hotelName,
  logoUrl,
  children,
  /** The settings preview renders this at a small size inside a panel. */
  preview = false,
}: {
  cfg: LoginConfig;
  hotelName: string;
  logoUrl?: string | null;
  children: ReactNode;
  preview?: boolean;
}) {
  const c = { ...DEFAULT_LOGIN, ...cfg };
  const ink = THEME_INK[c.theme] ?? THEME_INK.dark;
  const wash = HERO_WASH[c.hero] ?? HERO_WASH.warm;
  const radius = c.corners === "sharp" ? "0px" : "1.5rem";

  const vars = {
    "--door-a": c.accent,
    "--door-b": c.accent2,
    "--door-bg": ink.bg,
    "--door-fg": ink.fg,
    "--door-soft": ink.soft,
    "--door-panel": ink.panel,
    "--door-line": ink.line,
    "--door-radius": radius,
    ...(c.font ? { "--door-font": c.font } : {}),
  } as CSSProperties;

  // "Spotlight" means light that follows you. Written straight to CSS
  // variables rather than through state: this fires on every mouse move, and a
  // re-render per pixel is how a login page starts feeling heavy.
  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (c.effect !== "spotlight") return;
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    },
    [c.effect],
  );

  const headline = c.headline?.trim() || `Welcome back to ${hotelName}`;
  const subline = c.subline?.trim() || "Sign in to start your shift.";

  const art = (
    <div className="mise-door-art" aria-hidden>
      <span className="mise-door-wash" style={{ background: wash }} />
      {c.effect === "aurora" && <span className="mise-door-aurora" />}
      {c.effect === "glow" && <span className="mise-door-glow" />}
      {c.effect === "grid" && <span className="mise-door-grid" />}
      {c.effect === "spotlight" && <span className="mise-door-spot" />}
    </div>
  );

  const brand = (
    <div className="mise-door-brand">
      {c.show_logo && logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="mise-door-logo" />
      ) : null}
      <h1 className="mise-door-headline">{headline}</h1>
      <p className="mise-door-subline">{subline}</p>
    </div>
  );

  return (
    <div
      className={`mise-door mise-door-${c.layout} ${preview ? "mise-door-preview" : ""}`}
      style={vars}
      data-effect={c.effect}
      onMouseMove={onMove}
    >
      {art}

      {c.layout === "split" ? (
        <>
          <section className="mise-door-side">{brand}</section>
          <section className="mise-door-form">
            <div className="mise-door-panel">{children}</div>
            {c.footer && <p className="mise-door-footer">{c.footer}</p>}
          </section>
        </>
      ) : (
        <section className="mise-door-centre">
          {brand}
          <div className="mise-door-panel">{children}</div>
          {c.footer && <p className="mise-door-footer">{c.footer}</p>}
        </section>
      )}
    </div>
  );
}
