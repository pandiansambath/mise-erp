// The last build's code stays on the server for one more deploy (§103.1 of
// docs/FEEDBACK): a page opened before a deploy still finds the files it asks
// for, instead of "This page couldn't load".
//
// The deploy copies the running image's .next/static into ./prev-static; this
// adds what it had OF ITS OWN (own.txt) to the new build's, never over a file
// the new build has, so an image holds two builds and no more. Every step is
// allowed to find nothing: a first deploy, a local build.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const NOW = ".next/static";
const LAST = "prev-static";
const LIST = "own.txt";

const walk = (dir, root = dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, root) : [relative(root, p).replaceAll("\\", "/")];
  });

if (!existsSync(NOW)) process.exit(0);
const own = walk(NOW).filter((f) => f !== LIST);
let kept = 0;
if (existsSync(LAST)) {
  const list = join(LAST, LIST);
  const theirs = existsSync(list) ? readFileSync(list, "utf8").split("\n").filter(Boolean) : walk(LAST);
  for (const f of theirs) {
    const from = join(LAST, f);
    const to = join(NOW, f);
    if (f.includes("..") || !existsSync(from) || existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    kept++;
  }
}
writeFileSync(join(NOW, LIST), own.join("\n"));
console.log(`static: ${own.length} of this build, ${kept} kept from the last`);
