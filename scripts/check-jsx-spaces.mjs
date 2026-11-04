/** No sentence may lose a space between the source and the screen.
 *
 *     "(weekly-paid)staff", "plan(it forecasts", "Salary advancesbelow"
 *
 * The source was right every time. The compiler in Next 16.2.7 drops the space
 * at the start of a piece of JSX text when that text ALSO contains an HTML
 * entity and has a line break in it, even only the one after its last word:
 *
 *     <b>x</b> it&apos;s        ->  "it's fine."     the space is gone
 *        fine.
 *
 *     <b>x</b> a dash — b       ->  " a dash — b c"  fine, no entity
 *        c
 *
 * So the page is wrong while the code reads correctly, tsc and eslint are happy,
 * and a reviewer looking at the source sees nothing. An explicit {" "} survives.
 *
 *     node scripts/check-jsx-spaces.mjs         report, and fail if any
 *     node scripts/check-jsx-spaces.mjs --fix   put the {" "} in
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "frontend/package.json"));
const ts = require("typescript");

const fix = process.argv.includes("--fix");
const SKIP = new Set(["node_modules", ".next", "public"]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

/** Where the leading spaces of each affected text sit in this file. */
function broken(path, src) {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const hits = [];
  const walk = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = src.slice(node.pos, node.end);
      const firstLine = text.split("\n")[0].replace(/\r$/, "");
      const spaces = firstLine.length - firstLine.trimStart().length;
      if (
        spaces > 0 &&
        firstLine.trim() &&
        text.includes("\n") &&
        /&[a-zA-Z#0-9]+;/.test(text)
      ) {
        hits.push({ pos: node.pos, spaces, text: firstLine.trim().slice(0, 50) });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

let count = 0;
for (const path of files(join(ROOT, "frontend"))) {
  let src = readFileSync(path, "utf8");
  const hits = broken(path, src);
  if (!hits.length) continue;
  count += hits.length;
  for (const h of hits) console.log(`${path}: "${h.text}"`);
  if (fix) {
    for (const h of [...hits].reverse()) {
      src = src.slice(0, h.pos) + '{" "}' + src.slice(h.pos + h.spaces);
    }
    writeFileSync(path, src);
  }
}

if (count && !fix) {
  console.error(`\n${count} sentence(s) will lose a space when compiled. Run with --fix.`);
  process.exit(1);
}
console.log(fix ? `fixed ${count}` : "jsx spaces clean");
