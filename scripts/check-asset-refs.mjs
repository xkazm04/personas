#!/usr/bin/env node
/**
 * check-asset-refs.mjs — every public-asset path named in src/ resolves to a file in public/.
 *
 * Usage:  node scripts/check-asset-refs.mjs [--json]
 *
 * Scans .ts/.tsx under src/ for string literals and template literals that start
 * with one of ASSET_ROOTS and end in an image/video extension. A template
 * placeholder (`${code}`) becomes a wildcard: the pattern must match AT LEAST ONE
 * file, and the matches are printed so a reviewer can compare the expansion with
 * the list the code iterates. It cannot know that list — a pattern that matches
 * 14 files while the code asks for a 15th is out of its reach; the expansion is
 * shown precisely so that gap is visible rather than implied closed.
 *
 * Exit 1 on any literal that names no file, or a pattern that matches none.
 * "Scanned nothing" is a failure too: zero references found exits 1.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, relative, extname } from "path";

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "public");
const ASSET_ROOTS = ["illustrations", "athena", "agent_icons", "vault-icons", "empty-states", "icons"];
const EXT = "png|jpe?g|webp|svg|gif|mp4|webm|ico";
const JSON_OUT = process.argv.includes("--json");

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, pred, out);
    } else if (pred(e.name)) out.push(p);
  }
  return out;
}

const publicFiles = new Set(walk(PUBLIC_DIR, () => true).map((p) => relative(PUBLIC_DIR, p).replace(/\\/g, "/")));
const sources = walk(join(ROOT, "src"), (n) => [".ts", ".tsx"].includes(extname(n)));
// quote, "/", root, "/", path, ".", ext, closing quote. Inside a template a `${…}` may
// itself hold quotes and spaces (`${isDark ? 'dark' : 'light'}`), so it is matched whole.
const ROOTS = ASSET_ROOTS.join("|");
const RE = new RegExp(
  `['"]/((?:${ROOTS})/[^'"\`\\s]*?\\.(?:${EXT}))['"]` +
    `|\`/((?:${ROOTS})/(?:\\$\\{[^}]*\\}|[^\`\\s$])*?\\.(?:${EXT}))\``,
  "g"
);

const misses = [];
const patterns = [];
let literalCount = 0;
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  if (!ASSET_ROOTS.some((r) => text.includes(`/${r}/`))) continue;
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // A comment that mentions a path is prose, not a reference.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(RE)) {
      const ref = m[1] ?? m[2];
      const at = `${rel}:${i + 1}`;
      if (ref.includes("${")) {
        const re = new RegExp(
          "^" + ref.split(/\$\{[^}]*\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+?") + "$"
        );
        const hits = [...publicFiles].filter((f) => re.test(f)).sort();
        patterns.push({ at, ref, hits });
        if (hits.length === 0) misses.push({ at, ref, kind: "pattern matches no file" });
      } else {
        literalCount++;
        if (!publicFiles.has(ref)) misses.push({ at, ref, kind: "no such file" });
      }
    }
  });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ literalCount, patterns, misses }, null, 1));
} else {
  console.log(`check-asset-refs — ${sources.length} source files, ${publicFiles.size} public files`);
  console.log(`  ${literalCount} literal reference(s), ${patterns.length} template pattern(s)`);
  for (const p of patterns) {
    console.log(`  PATTERN ${p.at}  /${p.ref}  -> ${p.hits.length} file(s)`);
    for (const h of p.hits) console.log(`      ${h}`);
  }
  for (const m of misses) console.log(`  MISS ${m.at}  /${m.ref}  (${m.kind})`);
}
if (literalCount + patterns.length === 0) {
  console.error("  FAIL: found no asset references at all — the matcher is broken, not the tree clean.");
  process.exit(1);
}
if (misses.length) {
  console.error(`  FAIL: ${misses.length} reference(s) resolve to nothing in public/.`);
  process.exit(1);
}
console.log("  OK");
