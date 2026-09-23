/** No button may dispatch an event nobody listens for.
 *
 * This has shipped THREE times on this project, and it is invisible every
 * time: the click registers, nothing errors, and the feature simply does not
 * exist for anyone who tries it.
 *
 *   - the onboarding "Import from a file instead" button — he clicked it
 *     four times and told us
 *   - the dashboard's equivalent
 *   - expenses "Scan a bill" — "litrelly that scan bill is not working"
 *
 * All three dispatched `mise:attach`, whose only listener lives in
 * `Copilot.tsx`, which the app shell has never mounted. A grep would have
 * found it in seconds at any point; nobody thought to grep, because nothing
 * was broken in a way anything could report.
 *
 * So the grep runs on every deploy instead.
 *
 * ⚠️ A LISTENER ONLY COUNTS IF ITS FILE IS ACTUALLY RENDERED.
 *
 * The first version of this gate just grepped for `addEventListener("mise:…")`
 * anywhere under `frontend/`. `Copilot.tsx` contains those listeners and is
 * mounted NOWHERE — so the gate written to catch this exact bug reported
 * "events clean, all heard" while pointing at the very file that caused it.
 * A check that green-lights its own motivating example is worse than no check,
 * because it is quoted as evidence.
 *
 * So this now builds the import graph from the real entry points — every
 * page, layout and route under `frontend/app` — and a listener in a file
 * nothing imports is treated as absent, which is what it is.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";

const FRONTEND = "frontend";
const ROOTS = [`${FRONTEND}/app`, `${FRONTEND}/components`, `${FRONTEND}/lib`];

/** Every source file we know about. */
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    // NORMALISED. `join` gives backslashes on Windows, so every later
    // path comparison written with "/" silently matched nothing — the
    // gate reported "0 of 239 files reachable" and still exited 0.
    if (/\.(tsx?|mjs)$/.test(name)) files.push(p.split(sep).join("/"));
  }
}
for (const r of ROOTS) walk(r);

// ── resolving an import to a file on disk ─────────────────────────────────

const CANDIDATES = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(FRONTEND, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null; // a package, not ours
  base = base.split(sep).join("/");
  for (const ext of CANDIDATES) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p.split(sep).join("/");
  }
  return null;
}

const importsOf = new Map();
const sourceOf = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  sourceOf.set(f, src);
  const out = new Set();
  // Covers `import x from "y"`, `import "y"`, and `await import("y")`.
  for (const m of src.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
    const hit = resolveImport(f, m[1]);
    if (hit) out.add(hit);
  }
  importsOf.set(f, out);
}

// ── what the app actually renders ─────────────────────────────────────────
//
// Next.js entry points. Anything reachable from one of these is live; anything
// else is a file that exists and never runs.

const ENTRY = /[\\/](page|layout|template|error|not-found|global-error|route|middleware)\.(tsx?|mjs)$/;
const live = new Set();
const queue = files.filter((f) => f.startsWith(`${FRONTEND}/app`) && ENTRY.test(f));
queue.push(...files.filter((f) => /[\\/]middleware\.tsx?$/.test(f)));

while (queue.length) {
  const f = queue.pop();
  if (live.has(f)) continue;
  live.add(f);
  for (const next of importsOf.get(f) ?? []) if (!live.has(next)) queue.push(next);
}

// ── the check ─────────────────────────────────────────────────────────────

const dispatched = new Map();
const heard = new Set();
/** Listeners that exist but can never run — reported, because they read as
 *  proof the feature works when somebody greps for them. */
const heardButDead = new Map();

for (const f of files) {
  const src = sourceOf.get(f);
  const isLive = live.has(f);
  for (const m of src.matchAll(/new CustomEvent\(\s*["']([^"']+)["']/g)) {
    if (!m[1].startsWith("mise:")) continue;
    if (!isLive) continue; // a dispatcher nothing renders cannot be pressed
    if (!dispatched.has(m[1])) dispatched.set(m[1], new Set());
    dispatched.get(m[1]).add(f);
  }
  for (const m of src.matchAll(/addEventListener\(\s*["'](mise:[^"']+)["']/g)) {
    if (isLive) heard.add(m[1]);
    else {
      if (!heardButDead.has(m[1])) heardButDead.set(m[1], new Set());
      heardButDead.get(m[1]).add(f);
    }
  }
}

const dead = [...dispatched.keys()].filter((e) => !heard.has(e));
if (dead.length) {
  console.error("Dispatched but nothing listens — these buttons do nothing:\n");
  for (const e of dead) {
    console.error(`  ${e}`);
    for (const f of dispatched.get(e)) console.error(`      from ${f}`);
    for (const f of heardButDead.get(e) ?? []) {
      console.error(`      a listener exists in ${f}, but nothing renders that file`);
    }
  }
  console.error(
    "\nEither mount the listener, or make the button do the thing directly.",
  );
  process.exit(1);
}

const orphanNote = heardButDead.size
  ? ` (${heardButDead.size} listener${heardButDead.size === 1 ? "" : "s"} in unrendered files, ignored)`
  : "";
console.log(
  `events clean (${dispatched.size} dispatched, all heard; ${live.size} of ${files.length} files reachable)${orphanNote}`,
);
