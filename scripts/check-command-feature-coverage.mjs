#!/usr/bin/env node
/**
 * check-command-feature-coverage — fails when the frontend can invoke a Tauri
 * command that the build configuration it is shipped in does not register.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (and why check-command-registration.mjs cannot cover it)
 * ---------------------------------------------------------------------------
 * `check-command-registration.mjs` asks: is every `#[tauri::command]` function
 * registered in SOME `generate_handler!` list? That question is answered over
 * the UNION of every cargo feature -- its own comment says duplicate names are
 * "cfg-gated variants of the same command and are not a finding". It is the
 * right question for the orphan direction and it is not this one.
 *
 * This script asks the per-configuration question: for the feature set a given
 * `tauri.*.conf.json` actually builds, is every command the frontend can name
 * present in that binary? Those are different questions because the two
 * selectors are INDEPENDENT. Which commands compile is decided by cargo
 * features in `src-tauri/Cargo.toml`; which commands the UI will call is
 * decided by the frontend tier (`VITE_APP_TIER`) and by ordinary imports.
 * Nothing asserts a relationship between them, so a command can be gated
 * behind `feature = "p2p"`, absent from the lite binary, and still reachable
 * from a code path the lite frontend ships.
 *
 * The failure that shape produces is `Command "…" not found` at runtime, in
 * the user's hands, far from the build that dropped it -- the first line of
 * docs/concepts/golden-paths/feature-flagged-compilation.md's trigger list.
 * A union check reports zero for it by construction, which is why this is a
 * second gate rather than a flag on the first.
 *
 * ---------------------------------------------------------------------------
 * THE BASELINE IS TWO-SIDED
 * ---------------------------------------------------------------------------
 * Same convention as check-command-registration.mjs and the census engine: the
 * run fails when a variant's exposure RISES above its recorded baseline, and
 * also when a recorded name DROPS OUT without the baseline being updated. A
 * silent drop is what a broken matcher looks like, and it is as much a signal
 * as a rise.
 *
 * The baseline is seeded with the exposure that existed when this gate landed.
 * That is not an endorsement of it: it is the standing surface, recorded so the
 * gate can hold the line while it is worked down. Entries are removed by making
 * them true, never by editing the file alone.
 *
 * Usage:
 *   node scripts/check-command-feature-coverage.mjs          # gate
 *   node scripts/check-command-feature-coverage.mjs --json   # machine-readable
 *   node scripts/check-command-feature-coverage.mjs --write-baseline
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCfgTest, isRustTestFile } from "./census/lib/instruments/stripCfgTest.mjs";
import { maskRustLiteralsAndComments } from "./census/lib/instruments/extractRustStrings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUST_SRC = resolve(ROOT, "src-tauri/src");
const CARGO_TOML = resolve(ROOT, "src-tauri/Cargo.toml");
const FRONTEND_SRC = resolve(ROOT, "src");
const BASELINE_PATH = resolve(ROOT, "scripts/command-feature-coverage-baseline.json");

/**
 * Floors. Below either of these the scan is untrustworthy and the run fails
 * with "matcher broken" rather than "clean" -- an empty registration set makes
 * every exposure disappear, which is a green run that means nothing. Values are
 * ~12% below what the tree held when this landed (1,634 registrations,
 * 1,438 invoke targets).
 */
const MIN_REGISTRATIONS = 1400;
const MIN_INVOCATIONS = 1200;

// ---------------------------------------------------------------------------
// cfg predicate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a `#[cfg(...)]` predicate against a feature set.
 *
 * Returns true/false, or `null` when the predicate uses a construct this
 * evaluator does not model. A null is reported as `unparsed` and fails the run:
 * guessing "satisfied" would hide exactly the exposure this gate exists to
 * find, and guessing "unsatisfied" would invent one.
 */
export function evalCfg(pred, { features, debugAssertions }) {
  const s = pred.trim();

  const fm = s.match(/^feature\s*=\s*"([^"]+)"$/);
  if (fm) return features.has(fm[1]);
  if (s === "debug_assertions") return debugAssertions;
  if (s === "test") return false;

  const call = s.match(/^(any|all|not)\s*\(([\s\S]*)\)$/);
  if (call) {
    const parts = splitTopLevel(call[2]);
    const vals = parts.map((p) => evalCfg(p, { features, debugAssertions }));
    if (vals.some((v) => v === null)) return null;
    if (call[1] === "any") return vals.some(Boolean);
    if (call[1] === "all") return vals.every(Boolean);
    return vals.length === 1 ? !vals[0] : null;
  }

  // target_os and friends: not modelled, and not silently assumed.
  return null;
}

/** Split `a, b(c, d), e` on top-level commas only. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// cargo features
// ---------------------------------------------------------------------------

/** Parse `[features]` from Cargo.toml into name -> [dependency feature names]. */
export function parseCargoFeatures(tomlText) {
  const out = new Map();
  const secIdx = tomlText.indexOf("\n[features]");
  if (secIdx === -1) return out;
  let body = tomlText.slice(secIdx + "\n[features]".length);
  const next = body.search(/\n\[[a-zA-Z]/);
  if (next !== -1) body = body.slice(0, next);

  // Strip `#` comments first: the desktop block carries prose containing
  // quoted phrases, and a naive `"([^"]+)"` sweep reads them as feature names.
  body = body
    .split("\n")
    .map((l) => l.replace(/#.*$/, ""))
    .join("\n");

  // `name = [ ... ]`, possibly spanning lines.
  for (const m of body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\[([\s\S]*?)\]/gm)) {
    const deps = [...m[2].matchAll(/"([^"]+)"/g)].map((d) => d[1]);
    out.set(m[1], deps);
  }
  return out;
}

/** Expand a feature list transitively through the local `[features]` table. */
export function expandFeatures(names, table) {
  const seen = new Set();
  const stack = [...names];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    // `dep/feature` entries enable a feature on another crate, not on this one.
    if (f.includes("/")) continue;
    if (f.startsWith("dep:")) continue;
    seen.add(f);
    for (const d of table.get(f) ?? []) stack.push(d);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// registrations, with the cfg that guards each one
// ---------------------------------------------------------------------------

function rustSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === "node_modules") continue;
      out.push(...rustSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".rs")) continue;
    const rel = full.slice(RUST_SRC.length + 1).split(/[\\/]/).join("/");
    if (isRustTestFile(rel)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Every command registered in a `generate_handler!` list, with the cfg
 * predicate guarding it (or null when unconditional).
 *
 * Bracket-matching runs over the MASKED source, because `lib.rs` carries an
 * unbalanced `[` inside a comment within the handler list -- the same reason
 * generate-command-names.mjs masks. Masking is offset- and line-preserving, so
 * the cfg predicate is read back out of the RAW text at the same line, where
 * the feature name still exists (masking would have blanked the string).
 */
export function discoverRegistrationsWithCfg(srcRoot = RUST_SRC) {
  const found = new Map(); // name -> cfg | null   (unconditional wins)
  for (const file of rustSourceFiles(srcRoot)) {
    const raw = readFileSync(file, "utf8");
    const masked = maskRustLiteralsAndComments(stripCfgTest(raw));
    const rawLines = raw.split("\n");

    const needle = "generate_handler![";
    let from = 0;
    for (;;) {
      const start = masked.indexOf(needle, from);
      if (start === -1) break;
      const open = start + needle.length;
      let depth = 1;
      let end = -1;
      for (let i = open; i < masked.length; i++) {
        if (masked[i] === "[") depth++;
        else if (masked[i] === "]" && --depth === 0) { end = i; break; }
      }
      if (end === -1) throw new Error(`unterminated generate_handler![ in ${file}`);

      const startLine = masked.slice(0, open).split("\n").length - 1; // 0-based
      const maskedBody = masked.slice(open, end).split("\n");

      let pendingCfg = null;
      for (let k = 0; k < maskedBody.length; k++) {
        const line = maskedBody[k].trim();
        if (!line) continue;
        const rawLine = (rawLines[startLine + k] ?? "").trim();
        const cfgm = rawLine.match(/^#\[cfg\((.+)\)\]$/);
        if (cfgm) { pendingCfg = cfgm[1]; continue; }
        let matched = false;
        for (const m of line.matchAll(/([A-Za-z_][A-Za-z0-9_:]*)\s*(?:,|$)/g)) {
          const name = m[1].split("::").pop();
          if (!name) continue;
          matched = true;
          if (found.get(name) == null && found.has(name)) continue; // already unconditional
          if (!found.has(name) || pendingCfg === null) found.set(name, pendingCfg);
        }
        if (matched) pendingCfg = null;
      }
      from = end + 1;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// frontend invoke targets
// ---------------------------------------------------------------------------

/** Command names the frontend passes to `invoke(...)`, excluding test code. */
export function discoverInvokedCommands(srcRoot = FRONTEND_SRC) {
  const names = new Map(); // name -> first file:line
  const EXT = new Set([".ts", ".tsx"]);
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", "dist", "__tests__", "__mocks__"].includes(e.name)) continue;
        walk(p);
        continue;
      }
      if (!EXT.has(extname(e.name))) continue;
      if (/\.(test|spec)\.[tj]sx?$/.test(e.name)) continue;
      const text = readFileSync(p, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(/invoke(?:<[^>]*>)?\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
          if (!names.has(m[1])) {
            names.set(m[1], `${p.slice(ROOT.length + 1).split(/[\\/]/).join("/")}:${i + 1}`);
          }
        }
      }
    }
  };
  walk(srcRoot);
  return names;
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

/**
 * Build variants, read from the tauri config files rather than hard-coded.
 *
 * Refuses an empty enumeration for the same reason the registration and
 * invocation floors exist: every per-variant check below iterates this list,
 * so zero variants makes every exposure vanish and prints "0 build variant(s)"
 * on the way to a clean exit. A renamed directory or a changed config
 * filename would look exactly like a tree with nothing to report.
 */
function discoverVariants() {
  const out = [];
  for (const f of readdirSync(resolve(ROOT, "src-tauri"))) {
    if (!/^tauri(\..+)?\.conf\.json$/.test(f)) continue;
    const conf = JSON.parse(readFileSync(resolve(ROOT, "src-tauri", f), "utf8"));
    const features = conf?.build?.features ?? conf?.features ?? [];
    if (!Array.isArray(features)) continue;
    out.push({ conf: f, declared: features });
  }
  if (out.length === 0) {
    console.error(
      "\nPartial scan: 0 build variants discovered in src-tauri/.\n" +
        "Refusing to report -- every per-variant check iterates this list, so an\n" +
        "empty enumeration exits clean while checking nothing. A renamed directory\n" +
        "or a changed config filename looks exactly like a tree with nothing to\n" +
        "report. Fix the walk.",
    );
    process.exit(1);
  }
  return out.sort((a, b) => a.conf.localeCompare(b.conf));
}

export function checkCommandFeatureCoverage() {
  const registrations = discoverRegistrationsWithCfg();
  const invoked = discoverInvokedCommands();
  const table = parseCargoFeatures(readFileSync(CARGO_TOML, "utf8"));

  const belowFloor =
    registrations.size < MIN_REGISTRATIONS || invoked.size < MIN_INVOCATIONS;

  const variants = [];
  const unparsed = new Set();

  for (const v of discoverVariants()) {
    // Shipped binaries are release builds; debug_assertions is off there, which
    // is the configuration a user actually runs.
    const features = expandFeatures(v.declared, table);
    const missing = [];
    for (const [name, cfg] of registrations) {
      if (!invoked.has(name)) continue;
      if (cfg === null) continue;
      const ok = evalCfg(cfg, { features, debugAssertions: false });
      if (ok === null) { unparsed.add(cfg); continue; }
      if (!ok) missing.push({ name, cfg, callSite: invoked.get(name) });
    }
    missing.sort((a, b) => a.name.localeCompare(b.name));
    variants.push({
      conf: v.conf,
      declared: v.declared,
      features: [...features].sort(),
      missing,
    });
  }

  return {
    registrationCount: registrations.size,
    invokedCount: invoked.size,
    belowFloor,
    unparsed: [...unparsed].sort(),
    variants,
  };
}

function currentExposure(result) {
  const out = {};
  for (const v of result.variants) out[v.conf] = v.missing.map((m) => m.name);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const result = checkCommandFeatureCoverage();

  if (args.includes("--write-baseline")) {
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comment:
            "Frontend-reachable commands absent from each build variant. Two-sided: " +
            "a rise fails, and so does a silent drop. Remove an entry by making it " +
            "true (register the command unconditionally, or stop the frontend from " +
            "reaching it in that variant), not by editing this file alone.",
          _generated: new Date().toISOString().slice(0, 10),
          exposure: currentExposure(result),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`baseline written to ${BASELINE_PATH}`);
    return;
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(
    `${result.registrationCount} registrations, ${result.invokedCount} frontend invoke target(s), ` +
      `${result.variants.length} build variant(s).`,
  );

  let failed = false;

  if (result.belowFloor) {
    failed = true;
    console.error(
      `\nPartial scan: ${result.registrationCount} registrations (floor ${MIN_REGISTRATIONS}), ` +
        `${result.invokedCount} invoke targets (floor ${MIN_INVOCATIONS}).\n` +
        "Refusing to report -- an empty set makes every exposure vanish, which looks\n" +
        "exactly like a clean tree. Fix the walk, or lower the floor in the same\n" +
        "commit that removes the commands.",
    );
  }

  if (result.unparsed.length) {
    failed = true;
    console.error(
      `\n${result.unparsed.length} cfg predicate(s) this gate cannot evaluate:\n` +
        result.unparsed.map((u) => `  #[cfg(${u})]`).join("\n") +
        "\n\nThey are reported rather than assumed: guessing 'satisfied' would hide the\n" +
        "exposure this gate exists to find. Extend evalCfg() to model them.",
    );
  }

  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")).exposure ?? {}
    : {};

  for (const v of result.variants) {
    const recorded = new Set(baseline[v.conf] ?? []);
    const now = v.missing.map((m) => m.name);
    const nowSet = new Set(now);
    const risen = now.filter((n) => !recorded.has(n));
    const dropped = [...recorded].filter((n) => !nowSet.has(n)).sort();

    console.log(
      `  ${v.conf.padEnd(28)} features=[${v.declared.join(",") || "none"}]  ` +
        `reachable-but-absent: ${now.length}`,
    );

    if (risen.length) {
      failed = true;
      const byName = new Map(v.missing.map((m) => [m.name, m]));
      console.error(
        `\n${risen.length} command(s) newly reachable-but-absent in ${v.conf}:\n` +
          risen
            .map((n) => `  ${n}  [cfg(${byName.get(n).cfg})]  called from ${byName.get(n).callSite}`)
            .join("\n") +
          "\n\nThe frontend can name these; this build does not register them, so the\n" +
          "invoke fails at runtime with `Command \"…\" not found`. Either register the\n" +
          "command unconditionally, gate the call site on the same axis, or record it\n" +
          "in the baseline with a reason.",
      );
    }

    if (dropped.length) {
      failed = true;
      console.error(
        `\n${dropped.length} baseline entr(y/ies) for ${v.conf} no longer reachable-but-absent:\n` +
          dropped.map((n) => `  ${n}`).join("\n") +
          "\n\nEither they were fixed (good -- delete the line) or the matcher stopped\n" +
          "seeing them (bad). A silent drop is as much a signal as a rise.",
      );
    }
  }

  if (failed) process.exit(1);
  console.log("Every frontend-reachable command is present in every build variant it ships in (or baselined).");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
