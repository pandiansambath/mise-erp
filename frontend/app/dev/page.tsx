// pandi-dev.dineai.cloud
//
// Served on its own subdomain via the middleware host rewrite, and gated by an
// env var so it can be taken down without a code change or a deploy:
//
//     DEV_PROFILE_ENABLED=0   →   404, as if the page never existed
//
// Default is ON. The check runs on the SERVER, so when it is off the page is
// never rendered and never shipped to the browser — hiding it with CSS would
// still send every byte and anyone could read it in devtools.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevProfile } from "@/dev/DevProfile";
import type { Photo } from "@/dev/Album";
import type { ResumeManifest } from "@/dev/Resume";
import { cleanMilestones, type Milestone } from "@/dev/profile";
import type { MusicManifest } from "@/dev/music";
import { DEFAULT_PORTRAITS, PORTRAIT_FILE, isPortraitLook, type PortraitSet } from "@/dev/portraits";
import { DEFAULT_DESIGN, DEFAULT_THEME, THEMES, isDesign, type DesignId } from "@/dev/theme";

// Read at request time, not build time: flipping the switch should take effect
// on restart without rebuilding the image.
export const dynamic = "force-dynamic";

function enabled(): boolean {
  const raw = (process.env.DEV_PROFILE_ENABLED ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}

export async function generateMetadata(): Promise<Metadata> {
  if (!enabled()) return {};
  return {
    // `absolute` escapes the root layout's "%s · DineAI" template — this
    // page is his, not the product's.
    title: { absolute: "Pandian Sambath — System Engineer" },
    description: "System Engineer in Chennai, India. Python, AWS and Generative AI.",
    // A personal page has no business in search results unless he asks for it.
    robots: { index: false, follow: false },
  };
}

// HIS PHOTOS ARE NOT IN THE CODEBASE ANY MORE.
//
//     "why the hell my photos is in github?? ... store in s3..from s3 u can
//      serve them instead of direct codebase"
//
// The album, its manifest, the profile pictures and the rank list live in the
// PRIVATE uploads bucket and come out through the backend (/api/dev-site/…).
// This page renders on the server, so it asks the backend directly, over the
// containers' own network — `backend:8000` is the compose service name.
const BACKEND = process.env.INTERNAL_API_URL ?? "http://backend:8000";

async function loadPhotos(): Promise<Photo[]> {
  try {
    const r = await fetch(`${BACKEND}/api/dev-site/album.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return [];
    return (await r.json()) as Photo[];
  } catch {
    // A missing manifest means the album build never ran. The page is still
    // worth serving — it just has no album — so this must not 500.
    return [];
  }
}

// The résumé (dev/scripts/publish_resume.py puts it in the same bucket).
// Missing, or not shaped as expected, means no résumé card — never a broken
// page. The names are checked because they become URLs on the page.
async function loadResume(): Promise<ResumeManifest | null> {
  try {
    const r = await fetch(`${BACKEND}/api/dev-site/resume/resume.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const m = (await r.json()) as ResumeManifest;
    const page = /^page-\d{1,2}\.webp$/;
    const sized = (p: { w: number; h: number }) => p.w > 0 && p.h > 0;
    const ok =
      /^[0-9a-f]{6,64}$/.test(m.version) &&
      Array.isArray(m.pages) &&
      m.pages.length > 0 &&
      m.pages.every((p) => page.test(p.src) && sized(p)) &&
      m.thumb?.src === "thumb.webp" &&
      sized(m.thumb) &&
      /^[\w-]+\.pdf$/.test(m.pdf) &&
      // No Word file when he replaced the résumé with a PDF alone.
      (m.docx === null || /^[\w-]+\.docx$/.test(m.docx));
    return ok ? m : null;
  } catch {
    return null;
  }
}

// What he saved with his password: his months, and the look visitors land on.
async function loadJSON(name: string): Promise<unknown> {
  try {
    const r = await fetch(`${BACKEND}/api/dev-site/${name}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const isTheme = (id: unknown): id is string => typeof id === "string" && THEMES.some((t) => t.id === id);

export default async function DevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!enabled()) notFound();
  const [photos, resume, rawMilestones, rawSite, rawMusic, rawPortrait, params] = await Promise.all([
    loadPhotos(),
    loadResume(),
    loadJSON("milestones.json"),
    loadJSON("site.json"),
    loadJSON("music.json"),
    loadJSON("portrait.json"),
    searchParams,
  ]);
  // His portrait photos and their pace, guarded: only names the server serves.
  const pr = (rawPortrait ?? {}) as { photos?: unknown; interval?: unknown; look?: unknown };
  const portraitFiles = (Array.isArray(pr.photos) ? pr.photos : [])
    .map((x) => String((x as { file?: unknown })?.file ?? ""))
    .filter((f) => PORTRAIT_FILE.test(f));
  // …and the look he set as the site's default (a visitor may pick another).
  const look = isPortraitLook(pr.look) ? pr.look : DEFAULT_PORTRAITS.look;
  const portraits: PortraitSet = portraitFiles.length
    ? {
        photos: portraitFiles.map((f) => `/api/dev-site/${f}`),
        interval: typeof pr.interval === "number" ? Math.min(3600, Math.max(3, Math.round(pr.interval))) : DEFAULT_PORTRAITS.interval,
        look,
      }
    : { ...DEFAULT_PORTRAITS, look };
  // His playlist, guarded: only names the server would serve.
  const m = (rawMusic ?? {}) as { tracks?: unknown; volume?: unknown };
  const music: MusicManifest = {
    tracks: (Array.isArray(m.tracks) ? m.tracks : []).filter(
      (t): t is MusicManifest["tracks"][number] =>
        !!t && /^[a-z0-9-]{1,48}\.(mp3|m4a|ogg)$/.test(String((t as { file?: unknown }).file)) && ["landing", "album", "both"].includes(String((t as { scope?: unknown }).scope)),
    ),
    volume: typeof m.volume === "number" ? Math.min(1, Math.max(0, m.volume)) : 0.6,
  };
  const milestones: Milestone[] | null = cleanMilestones(rawMilestones);
  const s = (rawSite ?? {}) as { theme?: unknown; design?: unknown };
  const site: { theme: string; design: DesignId } = {
    theme: isTheme(s.theme) ? s.theme : DEFAULT_THEME,
    design: typeof s.design === "string" && isDesign(s.design) ? s.design : DEFAULT_DESIGN,
  };
  // A shared link (?theme=aurora&design=metro) opens exactly that look.
  const t = typeof params.theme === "string" ? params.theme : undefined;
  const d = typeof params.design === "string" ? params.design : undefined;
  const initial = { theme: isTheme(t) ? t : undefined, design: d && isDesign(d) ? d : undefined };
  return <DevProfile photos={photos} resume={resume} milestones={milestones} site={site} initial={initial} music={music} portraits={portraits} />;
}
