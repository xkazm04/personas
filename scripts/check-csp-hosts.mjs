#!/usr/bin/env node
/**
 * Every host the frontend `fetch`es must be allowed by `connect-src` in BOTH
 * `csp` and `devCsp` in src-tauri/tauri.conf.json.
 *
 * Why this exists: `src/features/.../crossrefClient.ts` targets
 * `api.crossref.org`, which has never appeared in either CSP string —
 * `git log -S"crossref" -- src-tauri/tauri.conf.json` returns nothing, ever.
 * The Crossref lookup in `AddSourceForm` is mounted in three live panels and
 * had been dead for 69 days, telling the user "The Crossref lookup failed.
 * Try again." The sibling feature added one commit earlier (`arxivClient.ts`)
 * shipped WITH its connect-src entry, so this is a per-author accident and
 * exactly the kind of thing a gate should hold.
 *
 * This is a must-be-COMPLETE condition, which the census runner cannot express
 * (it ratchets a count downward; it cannot assert an allowlist covers a set).
 * So it lives here instead. See docs/concepts/golden-paths/outbound-http-call.md.
 *
 * Instrument-before-result: exits 2 if it finds no fetch call sites or no
 * connect-src hosts. A checker that silently measures nothing passes forever.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC = resolve(ROOT, "src");
const CONF = resolve(ROOT, "src-tauri/tauri.conf.json");

/**
 * Hosts that are not real network targets.
 *
 * `*.localhost` covers Tauri's custom-protocol hosts (`asset.localhost`) and
 * dev-only harness hosts (`stream-test.localhost`, allowed in devCsp and
 * deliberately absent from the packaged CSP). Matching the suffix rather than
 * listing names keeps a new harness host from failing the build on day one.
 */
function isNonNetworkHost(host) {
  const bare = host.split(":")[0];
  return bare === "localhost" || bare.endsWith(".localhost") || bare === "0.0.0.0";
}

/**
 * Coverage counters for the POPULATION axis.
 *
 * The instrument-before-result assertion above covers the sensor axis — did
 * this checker find anything to measure. It says nothing about how much of the
 * tree the checker was never offered, and "all allowed" over a silently
 * reduced file set is a claim the reader cannot size. This gate is sound today
 * only because every executable file under `src/` happens to carry one of the
 * two extensions below; that is an invariant nothing here enforces, so print
 * the denominator and let a change in it be visible.
 */
const excluded = { extension: 0, prunedDir: 0 };

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") {
      excluded.prunedDir++;
      continue;
    }
    const path = join(dir, ent.name);
    if (ent.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
    else excluded.extension++;
  }
  return out;
}

/** Balanced-paren capture of a call's argument list, starting after the `(`. */
function captureArgs(text, start) {
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
  }
  return text.slice(start, i - 1);
}

/**
 * Blank out comments so a docs URL in a comment is never read as a target.
 *
 * The `(?<!:)` is load-bearing and was the second bug this file's own
 * instrument-before-result guard caught: `https://` CONTAINS `//`, so a naive
 * line-comment stripper blanks the rest of every line holding a URL — which is
 * every line this script exists to read. It reported zero hosts twice for two
 * different reasons. Fixed-length lookbehind, so it stays fast.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Hosts a file may fetch.
 *
 * Deliberately file-scoped rather than call-scoped. The first version of this
 * captured only the `fetch(...)` argument list and resolved same-file const
 * bases — and found ZERO hosts, because the real shape is
 *
 *     const url = doi ? `https://api.crossref.org/works/${…}` : `https://…`;
 *     …20 lines of AbortController…
 *     const res = await fetch(url, { … });
 *
 * A URL assembled several statements before the call is the normal spelling
 * here, not the exception, so anchoring on the call site measures nothing.
 * The instrument-before-result guard below is what caught that; without it
 * this file would have exited 0 and looked like a working gate.
 *
 * The trade is over-approximation: an absolute URL in a fetch-containing file
 * that is NOT fetched (e.g. one handed to an external-open) is flagged.
 * Measured before shipping — see the header of the violations report.
 */
function fetchedHosts(text) {
  const src = stripComments(text);
  if (!/\bfetch\s*\(/.test(src)) return new Map();

  const hosts = new Map(); // host -> first line
  for (const url of src.matchAll(/['"`](https?:\/\/[^'"`\s${)]+)/g)) {
    // XML namespace URIs are identifiers, never fetched. Excluded by
    // construction rather than by allowlisting arxiv.org: the discriminator is
    // the `…NS(` callee, which is what makes the URL a name instead of an
    // address. `getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'doi')`
    // was this gate's only false positive of that family.
    if (/\b\w+NS\s*\(\s*$/.test(src.slice(Math.max(0, url.index - 60), url.index))) continue;

    const host = url[1].replace(/^https?:\/\//, "").split("/")[0];
    if (!hosts.has(host)) hosts.set(host, src.slice(0, url.index).split("\n").length);
  }
  return hosts;
}

/** connect-src source list, as bare host patterns. */
function connectSrcHosts(csp) {
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src "));
  if (!directive) return [];
  return directive
    .slice("connect-src ".length)
    .split(/\s+/)
    .filter((s) => /^https?:\/\//.test(s))
    .map((s) => s.replace(/^https?:\/\//, "").replace(/:\*$/, "").split("/")[0]);
}

/** CSP3 host matching: exact, or a single leading `*.` wildcard. */
function allowed(host, patterns) {
  return patterns.some((p) =>
    p.startsWith("*.") ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p,
  );
}

const conf = JSON.parse(readFileSync(CONF, "utf8"));
const security = conf?.app?.security ?? {};
const csps = [
  ["csp", connectSrcHosts(security.csp ?? "")],
  ["devCsp", connectSrcHosts(security.devCsp ?? "")],
];

const scanned = walk(SRC);
const sites = [];
for (const file of scanned) {
  for (const [host, line] of fetchedHosts(readFileSync(file, "utf8"))) {
    if (isNonNetworkHost(host) || host.includes("${")) continue;
    sites.push({ host, line, file: file.slice(ROOT.length + 1).replaceAll("\\", "/") });
  }
}

// Instrument-before-result.
if (sites.length === 0) {
  console.error("check-csp-hosts: found ZERO frontend fetch hosts — the scanner is broken, not the code.");
  process.exit(2);
}
for (const [name, hosts] of csps) {
  if (hosts.length === 0) {
    console.error(`check-csp-hosts: parsed ZERO connect-src hosts from ${name} — the parser is broken.`);
    process.exit(2);
  }
}

const violations = [];
for (const site of sites) {
  const missing = csps.filter(([, hosts]) => !allowed(site.host, hosts)).map(([name]) => name);
  if (missing.length) violations.push({ ...site, missing });
}

if (violations.length) {
  console.error(
    `${violations.length} frontend fetch target(s) are not allowed by connect-src.\n` +
    "The request is blocked by the webview before it leaves the app, so the feature fails\n" +
    "with a generic network error and no CSP violation reaches your error handler:\n" +
    violations
      .map((v) => `  - ${v.file}:${v.line} → ${v.host}   (missing from: ${v.missing.join(", ")})`)
      .join("\n") +
    "\n\nAdd the host to connect-src in src-tauri/tauri.conf.json, or move the call behind a Tauri command.",
  );
  process.exit(1);
}

const enumerated = scanned.length + excluded.extension;
console.log(
  `CSP hosts OK — ${sites.length} frontend fetch target(s) across ` +
  `${new Set(sites.map((s) => s.host)).size} host(s), all allowed by csp and devCsp.\n` +
  `  scanned ${scanned.length} of ${enumerated} file(s) under src/ ` +
  `(${excluded.extension} excluded: not .ts/.tsx; ${excluded.prunedDir} dir(s) pruned).`,
);
