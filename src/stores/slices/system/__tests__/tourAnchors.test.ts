import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TOUR_REGISTRY } from "../tourSlice";

/**
 * Anchor-drift gate.
 *
 * Every guided-tour step (and sub-step) haloes a UI element by its
 * `highlightTestId` — `TourSpotlight` does `querySelector([data-testid="…"])`.
 * If the target testid is never rendered, the spotlight silently shows
 * "not on screen yet" for the whole step. That is exactly what happened to all
 * eight Obsidian Brain steps: their anchors lived only in the tour registry and
 * were emitted at runtime via a `obsidian-${tab}-panel` TEMPLATE literal, so no
 * static scan (scout or otherwise) could see them and the drift went unnoticed.
 *
 * This test walks the REAL `TOUR_REGISTRY` (imported, not copied) and asserts
 * every anchor is actually present in the `src/` tree as a testid — turning
 * future anchor drift into a red test at commit time instead of a dead
 * spotlight a user discovers.
 *
 * Coverage rules for an anchor `A` (a hit under either passes):
 *  1. VERBATIM — `A` appears somewhere in the source corpus. This catches
 *     `data-testid="A"`, the `testId: 'A'` prop pattern, and literal-map values
 *     like `{ setup: 'obsidian-setup-panel' }`.
 *  2. DYNAMIC TEMPLATE — some source has `data-testid={`PREFIX${…}`}` and
 *     `A` starts with `PREFIX` AND the remainder appears as a quoted string
 *     literal (a tab/id value) in the corpus. This covers genuinely dynamic
 *     testids (e.g. `data-testid={`design-subtab-${tab.id}`}` → the
 *     `design-subtab-use-cases` anchor, matched via the quoted `'use-cases'`
 *     tab id). This is data-driven, not a hand-maintained allowlist: remove the
 *     template or the id literal and the anchor fails again — the escape hatch
 *     shrinks itself.
 *
 * The corpus excludes test/spec files and `tourSlice.ts` itself (the anchor's
 * own definition must not count as its rendered presence).
 *
 * (Lives in __tests__/ because it uses node builtins, which the app tsconfig
 * excludes from typecheck — matching src/lib/credentials/__tests__.)
 */

// Vitest runs from the repo root, so `src/` is a stable child of cwd.
const SRC_DIR = join(process.cwd(), "src");

function collectSourceFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      entry.name !== "tourSlice.ts"
    ) {
      acc.push(full);
    }
  }
  return acc;
}

// Single pass: read the corpus once, then derive the verbatim string and the
// set of dynamic `data-testid` template prefixes from it.
const corpus = collectSourceFiles(SRC_DIR, [])
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const TEMPLATE_PREFIX_RE = /data-testid=\{`([A-Za-z0-9_-]+-)\$\{/g;
const dynamicPrefixes: string[] = [
  ...new Set(
    Array.from(corpus.matchAll(TEMPLATE_PREFIX_RE), (m) => m[1]).filter(
      (p): p is string => typeof p === "string",
    ),
  ),
];

function isAnchorRendered(anchor: string): boolean {
  if (corpus.includes(anchor)) return true; // rule 1: verbatim
  for (const prefix of dynamicPrefixes) {
    if (anchor.startsWith(prefix) && anchor.length > prefix.length) {
      const suffix = anchor.slice(prefix.length);
      if (corpus.includes(`'${suffix}'`) || corpus.includes(`"${suffix}"`)) {
        return true; // rule 2: dynamic template + quoted id literal
      }
    }
  }
  return false;
}

interface AnchorRef {
  tourId: string;
  stepPath: string;
  anchor: string;
}

function collectRegistryAnchors(): AnchorRef[] {
  const refs: AnchorRef[] = [];
  for (const tour of TOUR_REGISTRY) {
    for (const step of tour.steps) {
      if (step.highlightTestId) {
        refs.push({ tourId: tour.id, stepPath: step.id, anchor: step.highlightTestId });
      }
      for (const sub of step.subSteps) {
        if (sub.highlightTestId) {
          refs.push({
            tourId: tour.id,
            stepPath: `${step.id}/${sub.id}`,
            anchor: sub.highlightTestId,
          });
        }
      }
    }
  }
  return refs;
}

describe("tour anchor-drift gate", () => {
  const anchors = collectRegistryAnchors();

  it("finds anchors to check (registry is non-empty)", () => {
    expect(anchors.length).toBeGreaterThan(0);
  });

  it("every tour highlightTestId is rendered as a testid somewhere in src/", () => {
    const missing = anchors.filter((ref) => !isAnchorRendered(ref.anchor));
    const report = missing
      .map((ref) => `  • tour "${ref.tourId}" step "${ref.stepPath}" → anchor "${ref.anchor}" not found in src/`)
      .join("\n");
    expect(
      missing.length,
      missing.length === 0
        ? ""
        : `${missing.length} tour anchor(s) have no rendered data-testid — the spotlight will show "not on screen yet":\n${report}\n\n` +
            `Fix: add data-testid="<anchor>" to the element the step points at, or correct the highlightTestId in tourSlice.ts.`,
    ).toBe(0);
  });
});
