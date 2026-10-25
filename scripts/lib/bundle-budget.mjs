// Single source of truth for the JS bundle size budget and the ratchet that
// enforces it.
//
// Imported by check-bundle-budget.mjs (the CI/local gate — ratchet engine +
// self-test) and bundle-size-report.mjs (the PR comment, and the original
// `--save-baseline` writer). Previously these two scripts plus the ci.yml
// CLI flags carried three independent copies of 850/5000 that could silently
// disagree (the report would say PASS while the gate said FAIL).
//
// HISTORY (corrected 2026-08-30): the "~778 KB main chunk" note that used to
// live here was never re-measured after it was written and drifted badly —
// the real build (measured 2026-08-30, after the immer/markdown eager-import
// fixes) is ~33,383 KB total across 1,452 chunks, with `vendor-three`
// (~1,009 KB) and the `en` locale chunk (~988 KB) both genuinely over any
// believable flat per-chunk number, and `index` itself at ~372 KB — nowhere
// near 778. A FLAT ceiling cannot describe an app this large without either
// being so loose it catches nothing or so tight it's permanently red.
//
// So MAX_CHUNK_KB / MAX_TOTAL_KB below are now a coarse fallback for when
// there is no baseline to compare against (e.g. the very first run) — NOT
// the primary gate. The primary gate is the RATCHET in `evaluateBudget()`:
// it compares the current build against the last honestly-measured build
// recorded in scripts/bundle-baseline.json and fails only when something
// grows beyond a small tolerance. Known-oversized chunks that are already in
// the baseline (vendor-three, en) are grandfathered at their recorded size —
// they fail the gate only if they grow further, not because they exceed the
// flat cap.

export const MAX_CHUNK_KB = 850;
export const MAX_TOTAL_KB = 5000;

// Ratchet tolerance: how much a chunk or the total may grow above its
// recorded baseline before the gate fails. Whichever is larger of a
// percentage (catches slow creep on big chunks) or a flat KB floor (catches
// creep on tiny chunks where 1% is sub-KB noise).
export const TOLERANCE_PCT = 0.01; // 1%
export const TOLERANCE_MIN_KB = 10;

export function tolerance(baselineKB) {
  return Math.max(baselineKB * TOLERANCE_PCT, TOLERANCE_MIN_KB);
}

/**
 * Strip the Vite content-hash from a chunk filename, e.g.
 *   index-C1anhLSB.js         -> index
 *   chart-vendor-ZQ-a7Ypa.js  -> chart-vendor
 */
export function normalizeChunkName(filename) {
  const base = filename.replace(/\.js$/, "");
  const match = base.match(/^(.+)-[A-Za-z0-9_-]{7,12}$/);
  return match ? match[1] : base;
}

/**
 * Turn a flat list of `{ file, sizeKB }` entries into the same normalized,
 * disambiguated `{ key -> sizeKB }` shape stored in bundle-baseline.json:
 * sorted descending by size first, so the largest chunk for a given logical
 * name keeps the bare name and duplicates get `#2`, `#3`, ... suffixes.
 */
export function buildChunkMap(entries) {
  const sorted = [...entries].sort((a, b) => b.sizeKB - a.sizeKB);
  const nameCounts = {};
  const map = {};
  for (const e of sorted) {
    const name = normalizeChunkName(e.file);
    const count = (nameCounts[name] = (nameCounts[name] || 0) + 1);
    const key = count === 1 ? name : `${name}#${count}`;
    map[key] = Math.round(e.sizeKB * 10) / 10;
  }
  return map;
}

/**
 * Key a chunk from the build's chunk graph (scripts/build/bundle-graph-vite-plugin.mjs).
 *
 * A chunk that is the facade of a module - an `import()` target, or the HTML
 * entry - is keyed by that module's repo path (`src/features/teams/FactoryPage.tsx`,
 * `src/i18n/section-locales/en/home.json`): stable across builds, unique, and
 * the thing a reviewer can open. A shared chunk with no facade is keyed
 * `shared:<name>`; name collisions among those fall back to `#2`, `#3` in size
 * order, as every key did before 2026-10-25.
 */
export function chunkKeyFromGraph(chunk) {
  return chunk.facade ?? `shared:${chunk.name}`;
}

/**
 * `{ key -> sizeKB }` for the chunks in a bundle graph. `sizeKBOf(file)` returns
 * a chunk file's size in KB (or null when the file is missing from dist/).
 */
export function buildGraphChunkMap(graph, sizeKBOf) {
  const rows = graph.chunks.map((c) => ({ key: chunkKeyFromGraph(c), sizeKB: sizeKBOf(c.file) }));
  rows.sort((a, b) => b.sizeKB - a.sizeKB);
  const counts = {};
  const map = {};
  for (const r of rows) {
    const n = (counts[r.key] = (counts[r.key] || 0) + 1);
    map[n === 1 ? r.key : `${r.key}#${n}`] = Math.round(r.sizeKB * 10) / 10;
  }
  return map;
}

/**
 * The files the app loads before first render: every entry chunk and the
 * transitive closure of its STATIC imports. Lazy (`import()`) chunks are not
 * startup, including the always-mounted lazy islands App.tsx fetches right
 * after mount - those are their own chunks and keep their own ratchet.
 */
export function startupFiles(graph) {
  const byFile = new Map(graph.chunks.map((c) => [c.file, c]));
  const seen = new Set();
  const stack = graph.chunks.filter((c) => c.isEntry).map((c) => c.file);
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of byFile.get(file)?.imports ?? []) stack.push(dep);
  }
  return [...seen].sort();
}

/**
 * Ratchet comparison: `current` ({ totalKB, startupKB?, chunks: {key: sizeKB} }) against
 * a recorded `baseline` of the same shape (or `null`/`undefined` if none
 * exists yet).
 *
 * Returns:
 *   violations   — anything present here means the gate should FAIL:
 *                    { kind: 'total'|'startup', currentKB, baselineKB, diffKB, toleranceKB }
 *                    { kind: 'chunk', key, currentKB, baselineKB, diffKB, toleranceKB }
 *                    { kind: 'new-chunk', key, currentKB, maxChunkKB }
 *   staleNotices — a DROP beyond tolerance, or a chunk that vanished. Never
 *                  fails the gate — printed as a "baseline stale, run
 *                  --update" notice:
 *                    { kind: 'total'|'chunk', key?, currentKB, baselineKB, diffKB }
 *                    { kind: 'removed-chunk', key, baselineKB }
 *   newChunks    — informational only: chunks with no baseline entry that
 *                  are still within the absolute MAX_CHUNK_KB ceiling.
 */
export function evaluateBudget(current, baseline, opts = {}) {
  const maxChunkKB = opts.maxChunkKB ?? MAX_CHUNK_KB;
  const maxTotalKB = opts.maxTotalKB ?? MAX_TOTAL_KB;

  const violations = [];
  const staleNotices = [];
  const newChunks = [];

  // ── Total ──────────────────────────────────────────────────────────
  if (baseline && typeof baseline.totalKB === "number") {
    const tol = tolerance(baseline.totalKB);
    const diff = current.totalKB - baseline.totalKB;
    if (diff > tol) {
      violations.push({
        kind: "total",
        currentKB: current.totalKB,
        baselineKB: baseline.totalKB,
        diffKB: diff,
        toleranceKB: tol,
      });
    } else if (diff < -tol) {
      staleNotices.push({
        kind: "total",
        currentKB: current.totalKB,
        baselineKB: baseline.totalKB,
        diffKB: diff,
      });
    }
  } else if (current.totalKB > maxTotalKB) {
    // No baseline at all — fall back to the absolute ceiling.
    violations.push({
      kind: "total",
      currentKB: current.totalKB,
      baselineKB: null,
      diffKB: current.totalKB - maxTotalKB,
      toleranceKB: 0,
    });
  }

  // ── Startup (entry + static imports) ───────────────────────────────
  // Ratcheted like the total, once both sides carry it (baselines written
  // before 2026-10-25 do not).
  if (typeof current.startupKB === "number" && typeof baseline?.startupKB === "number") {
    const tol = tolerance(baseline.startupKB);
    const diff = current.startupKB - baseline.startupKB;
    if (diff > tol) {
      violations.push({ kind: "startup", currentKB: current.startupKB, baselineKB: baseline.startupKB, diffKB: diff, toleranceKB: tol });
    } else if (diff < -tol) {
      staleNotices.push({ kind: "startup", currentKB: current.startupKB, baselineKB: baseline.startupKB, diffKB: diff });
    }
  }

  // ── Per-chunk ──────────────────────────────────────────────────────
  const baselineChunks = baseline?.chunks ?? {};
  for (const [key, sizeKB] of Object.entries(current.chunks)) {
    const baselineKB = baselineChunks[key];
    if (baselineKB === undefined) {
      // Brand new chunk — no ratchet history yet. Guard with the absolute
      // cap so a new chunk can't sneak in already oversized.
      if (sizeKB > maxChunkKB) {
        violations.push({ kind: "new-chunk", key, currentKB: sizeKB, maxChunkKB });
      } else {
        newChunks.push({ key, currentKB: sizeKB });
      }
      continue;
    }

    const tol = tolerance(baselineKB);
    const diff = sizeKB - baselineKB;
    if (diff > tol) {
      violations.push({ kind: "chunk", key, currentKB: sizeKB, baselineKB, diffKB: diff, toleranceKB: tol });
    } else if (diff < -tol) {
      staleNotices.push({ kind: "chunk", key, currentKB: sizeKB, baselineKB, diffKB: diff });
    }
  }

  // ── Chunks that vanished from the build entirely ──────────────────
  for (const key of Object.keys(baselineChunks)) {
    if (!(key in current.chunks)) {
      staleNotices.push({ kind: "removed-chunk", key, baselineKB: baselineChunks[key] });
    }
  }

  return { violations, staleNotices, newChunks };
}
