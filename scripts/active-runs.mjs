#!/usr/bin/env node
// Active-runs ledger — the deterministic half of parallel-session coordination.
//
// WHY THIS EXISTS (2026-08-21). `.claude/active-runs.md` is the coordination
// surface for concurrent CLI sessions. Until now the register/check/deregister
// ritual lived ONLY as prose, duplicated across 23 skill files, with no
// implementation anywhere. Prose duplicated 23 ways drifts, and it did: the file
// had grown to 3,429 lines with TWO `## Active` sections (47 and 79 entries)
// while its own contract says "`## Active` is the source of truth", THREE
// "Recently completed" sections against a documented 14-day rolling window, and
// 13 entries still marked `started` that no session ever closed.
//
// Every one of those is a deterministic operation an agent was asked to perform
// by hand. That is the split this script restores: code parses, places, times,
// compares and trims; the agent supplies only judgment (the slug, the paths, and
// what to do about a real conflict).
//
// Usage:
//   node scripts/active-runs.mjs check    --paths "a/**" "b/"       [--json]
//   node scripts/active-runs.mjs register --slug s --title t --paths "a/**" [--source url]
//   node scripts/active-runs.mjs complete --slug s --status "completed (commit: abc1234)"
//   node scripts/active-runs.mjs doctor   [--json]
//
// Exit codes: 0 ok · 1 usage/IO error · 2 `check` found a live conflict.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = resolve(REPO, ".claude/active-runs.md");
const ACTIVE = "## Active";
const DONE = "## Recently completed";
const STALE_HOURS = 2;
const KEEP_DAYS = 14;
const SELF = ".claude/active-runs.md"; // expected overlap — never a conflict

const args = process.argv.slice(2);
const cmd = args[0];
const JSON_OUT = args.includes("--json");

function flag(name, multi = false) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return multi ? [] : undefined;
  if (!multi) return args[i + 1];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]);
  return out;
}

const read = () => readFileSync(LEDGER, "utf8");

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- parsing -----------------------------------------------------------------
// A section owns every entry until the next `## ` heading. Deliberately
// tolerant: this file has been hand-edited for months and a strict parser would
// be useless on it.
//
// TWO entry formats exist and both are live — itself a symptom of the drift this
// script exists to stop. The heading form (`### <slug> — <title>`) is current;
// the list form (`- **[<ts>] /<skill> — <slug>**` with indented sub-bullets) is
// what the older `## Active` section still uses. A parser that knew only the
// first silently missed 9 of 11 `started` entries — and "found nothing" and
// "looked at nothing" are different outcomes, so both shapes are recognized.
//
// NOTE: the \r?$ is load-bearing. The ledger is CRLF, and JS "." does not
// match a carriage return, so a bare $ anchor matches nothing here and the parser
// silently reports an empty file.
const HEADING_ENTRY = /^### (.+?)\r?$/;
// The bracket is NOT one shape. Observed in the live ledger, all four legal:
//   [2026-05-16 14:42]   [2026-05-18]   [2026-05-18 — started]   [2026-05-16 14:42 — started]
// So: pin the date, accept anything up to the `]`, and mine the time out of the
// tail only if it is there. A stricter matcher missed 32 entries and then
// mis-attributed their `Status:` lines to whichever entry preceded them.
const LIST_ENTRY = /^- \*\*\[(\d{4}-\d{2}-\d{2})([^\]]*)\]\s*(.*?)\*\*\s*\r?$/;

function slugFromHeading(s) {
  return s.split(/\s+—\s+/)[0].trim();
}

function slugFromListEntry(rest) {
  // "/research — <slug>" → "<slug>";  "<slug>" → "<slug>"
  const parts = rest.split(/\s+—\s+/).map((x) => x.trim()).filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "").replace(/\*+$/, "").trim();
}

function parse(text) {
  const lines = text.split("\n");
  const sections = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      cur = { heading: line.trim(), start: i, entries: [] };
      sections.push(cur);
      return;
    }
    if (!cur) return;
    const h = line.match(HEADING_ENTRY);
    if (h) {
      cur.entries.push({ line: i, slug: slugFromHeading(h[1]), form: "heading" });
      return;
    }
    const l = line.match(LIST_ENTRY);
    if (l) {
      cur.entries.push({ line: i, slug: slugFromListEntry(l[3]), form: "list" });
    }
  });
  sections.forEach((s, si) => {
    s.entries.forEach((e, k) => {
      const next = s.entries[k + 1]?.line ?? sections[si + 1]?.start ?? lines.length;
      e.end = next;
      e.body = lines.slice(e.line, next).join("\n");
      e.paths = extractPaths(e.body);
      e.status = (e.body.match(/\*\*Status:\*\*\s*(.+)/) || [])[1]?.trim() ?? null;
      // date is required; time is optional (see LIST_ENTRY note on bracket shapes)
      const ts = e.body.match(/\[(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
      e.ts = ts ? `${ts[1]} ${ts[2] ?? "00:00"}` : null;
    });
  });
  return { lines, sections };
}

function extractPaths(body) {
  const m = body.match(/\*\*Paths:\*\*\s*(.+)/);
  if (!m) return [];
  return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter(Boolean);
}

const norm = (p) => p.replace(/\\/g, "/").replace(/\/?\*+$/, "").replace(/\/+$/, "").trim();

function overlaps(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

function hoursSince(ts) {
  if (!ts) return Infinity;
  const d = new Date(ts.replace(" ", "T"));
  return Number.isNaN(Number(d)) ? Infinity : (Date.now() - Number(d)) / 36e5;
}

const activeSections = (p) => p.sections.filter((s) => s.heading === ACTIVE);
const doneSections = (p) => p.sections.filter((s) => s.heading.startsWith(DONE));

function die(msg) {
  console.error(`active-runs: ${msg}`);
  process.exit(1);
}

// --- commands ----------------------------------------------------------------
function cmdCheck() {
  const mine = flag("paths", true);
  if (!mine.length) die("check requires --paths <glob> [glob...]");
  const p = parse(read());
  const conflicts = [];
  for (const s of activeSections(p)) {
    for (const e of s.entries) {
      if (!/^started\b/i.test(e.status ?? "")) continue;
      if (hoursSince(e.ts) >= STALE_HOURS) continue;
      const hits = e.paths.filter(
        (tp) => norm(tp) !== norm(SELF) && mine.some((mp) => overlaps(mp, tp)),
      );
      if (hits.length) conflicts.push({ slug: e.slug, ageHours: Number(hoursSince(e.ts).toFixed(1)), overlap: hits });
    }
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ conflicts }, null, 2));
  } else if (!conflicts.length) {
    console.log("no live conflicts");
  } else {
    for (const c of conflicts) console.log(`CONFLICT ${c.slug} (${c.ageHours}h old) overlaps: ${c.overlap.join(", ")}`);
  }
  process.exit(conflicts.length ? 2 : 0);
}

function cmdRegister() {
  const slug = flag("slug");
  const title = flag("title");
  const paths = flag("paths", true);
  const source = flag("source");
  if (!slug || !title || !paths.length) die("register requires --slug --title --paths");
  const p = parse(read());
  const target = activeSections(p)[0];
  if (!target) die("no `## Active` section in the ledger");
  if (target.entries.some((e) => e.slug === slug)) die(`slug '${slug}' is already active — pick another or complete it first`);
  const entry = [
    "",
    `### ${slug} — ${title}`,
    `- **[${stamp()}]**${source ? ` Source: ${source}` : ""}`,
    `- **Paths:** ${paths.map((x) => `\`${x}\``).join(" · ")}`,
    "- **Status:** started",
  ];
  const out = [...p.lines];
  out.splice(target.start + 1, 0, ...entry);
  writeFileSync(LEDGER, out.join("\n"), "utf8");
  console.log(`registered ${slug}`);
}

function cmdComplete() {
  const slug = flag("slug");
  const status = flag("status") ?? "completed";
  if (!slug) die("complete requires --slug");
  const p = parse(read());
  let found = null;
  for (const s of activeSections(p)) {
    const e = s.entries.find((x) => x.slug === slug);
    if (e) {
      found = e;
      break;
    }
  }
  if (!found) die(`no active entry with slug '${slug}'`);
  const body = found.body.replace(/- \*\*Status:\*\*.*/, `- **Status:** ${status}`).replace(/\s+$/, "");
  const without = [...p.lines.slice(0, found.line), ...p.lines.slice(found.end)];
  const p2 = parse(without.join("\n"));
  const done = doneSections(p2)[0];
  if (!done) die("no `## Recently completed` section");
  const out = [...p2.lines];
  out.splice(done.start + 1, 0, "", ...body.split("\n"));
  writeFileSync(LEDGER, out.join("\n"), "utf8");
  console.log(`completed ${slug} — ${status}`);
}

function cmdDoctor() {
  const p = parse(read());
  const act = activeSections(p);
  const dn = doneSections(p);
  const staleStarted = [];
  for (const s of act) {
    for (const e of s.entries) {
      if (/^started\b/i.test(e.status ?? "") && hoursSince(e.ts) > STALE_HOURS) {
        staleStarted.push({ slug: e.slug, ageHours: Math.round(hoursSince(e.ts)) });
      }
    }
  }
  let old = 0;
  for (const s of dn) {
    for (const e of s.entries) if (hoursSince(e.ts) / 24 > KEEP_DAYS) old++;
  }
  const problems = [
    act.length !== 1 && `${act.length} \`## Active\` sections — the contract says exactly one is the source of truth`,
    dn.length !== 1 && `${dn.length} "Recently completed" sections — should be one rolling ${KEEP_DAYS}-day window`,
    staleStarted.length && `${staleStarted.length} entries still marked \`started\` past ${STALE_HOURS}h — never deregistered`,
    old && `${old} completed entries older than ${KEEP_DAYS} days — trim them`,
  ].filter(Boolean);
  const report = {
    lines: p.lines.length,
    activeSections: act.length,
    activeEntries: act.reduce((n, s) => n + s.entries.length, 0),
    completedSections: dn.length,
    staleStarted,
    olderThanKeepWindow: old,
    problems,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`ledger: ${report.lines} lines · ${report.activeEntries} active entries`);
  if (!problems.length) console.log("no structural problems");
  else problems.forEach((x) => console.log(`  PROBLEM  ${x}`));
  if (staleStarted.length) {
    console.log(`  stale: ${staleStarted.map((s) => `${s.slug}(${s.ageHours}h)`).join(", ")}`);
  }
  // doctor REPORTS; it never rewrites. A coordination file other sessions are
  // actively reading is not something to auto-repair behind their backs.
}

switch (cmd) {
  case "check":
    cmdCheck();
    break;
  case "register":
    cmdRegister();
    break;
  case "complete":
    cmdComplete();
    break;
  case "doctor":
    cmdDoctor();
    break;
  default:
    console.error("usage: active-runs.mjs <check|register|complete|doctor> [flags]  (see file header)");
    process.exit(1);
}
