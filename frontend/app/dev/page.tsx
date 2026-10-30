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
    description: "System Engineer in Chennai, India. Python, AWS, Docker, Terraform.",
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

export default async function DevPage() {
  if (!enabled()) notFound();
  return <DevProfile photos={await loadPhotos()} />;
}
