/** Every sidebar sub-section must exist on the page it points at.
 *
 *     "thta sub section issue: not only for what i said..also check for all
 *      the pages please..whtehr sub section are wokring are not"
 *     "wat the hell...still same issue...subb sections note wokeing"
 *
 * `lib/sections.ts` lists what each page can do, so the sidebar can offer those
 * jobs from anywhere. The keys must match the `key` on that page's SubNav
 * items, because that is what `?section=` is matched against — and the file
 * says so itself, in its own header comment:
 *
 *     "a wrong key simply does nothing rather than break"
 *
 * Which is precisely why he clicked several of them, got nothing, and had to
 * report it twice. Three keys on /attendance were aspirational and dead; one
 * on /rota described a page that was never built that way. Nothing could have
 * told anyone that except clicking all of them.
 *
 * So it is checked on every deploy instead of on his tablet.
 */
import { existsSync, readFileSync } from "node:fs";

const SRC = "frontend/lib/sections.ts";
const src = readFileSync(SRC, "utf8");

// The declaration block, route by route.
const body = src.slice(src.indexOf("export const SECTIONS"));
const routes = [...body.matchAll(/"(\/[a-z0-9/-]+)":\s*\[([\s\S]*?)\n\s*\],/g)];

if (!routes.length) {
  console.error(`check-sections: parsed no routes out of ${SRC} — the shape changed.`);
  process.exit(1);
}

/** Where a route's page file lives. The app dir uses a (app) route group. */
function pageFor(route) {
  const candidates = [
    `frontend/app/(app)${route}/page.tsx`,
    `frontend/app${route}/page.tsx`,
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

let broken = 0;
let checked = 0;

for (const [, route, block] of routes) {
  const keys = [...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
  const page = pageFor(route);
  if (!page) {
    console.error(`  ${route} — no page file for this route at all`);
    broken += keys.length;
    continue;
  }
  const pageSrc = readFileSync(page, "utf8");
  // Whatever the page declares as its own actions. Two shapes, and missing
  // the second one gave a false positive on /attendance the first time this
  // ran: SubNav and PageMore entries carry `key: "…"`, but a page can also
  // handle a section itself in a `useDeepLink` comparison — `v === "find"`.
  const onPage = new Set([
    ...[...pageSrc.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]),
    ...[...pageSrc.matchAll(/[=!]==\s*"([a-z0-9-]{1,24})"/g)].map((m) => m[1]),
  ]);
  for (const k of keys) {
    checked += 1;
    if (!onPage.has(k)) {
      console.error(
        `  ${route} → "${k}" is offered in the sidebar and does not exist on the page`,
      );
      broken += 1;
    }
  }
}

if (broken) {
  console.error(
    `\n${broken} sidebar sub-section${broken === 1 ? "" : "s"} point at nothing.`,
  );
  console.error(
    "Either add the action to the page's SubNav, or drop it from lib/sections.ts.",
  );
  process.exit(1);
}
console.log(`sections clean (${checked} sub-sections, every one lands somewhere)`);
