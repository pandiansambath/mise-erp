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
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["frontend/app", "frontend/components", "frontend/lib"];
const dispatched = new Map();
const heard = new Set();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(tsx?|mjs)$/.test(name)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/new CustomEvent\(\s*["']([^"']+)["']/g)) {
      if (!m[1].startsWith("mise:")) continue;
      if (!dispatched.has(m[1])) dispatched.set(m[1], new Set());
      dispatched.get(m[1]).add(p);
    }
    for (const m of src.matchAll(/addEventListener\(\s*["'](mise:[^"']+)["']/g)) {
      heard.add(m[1]);
    }
  }
}

for (const r of ROOTS) walk(r);

const dead = [...dispatched.keys()].filter((e) => !heard.has(e));
if (dead.length) {
  console.error("Dispatched but nothing listens — these buttons do nothing:\n");
  for (const e of dead) {
    console.error(`  ${e}`);
    for (const f of dispatched.get(e)) console.error(`      from ${f}`);
  }
  console.error(
    "\nEither mount the listener, or make the button do the thing directly.",
  );
  process.exit(1);
}
console.log(`events clean (${dispatched.size} dispatched, all heard)`);
