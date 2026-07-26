/**
 * Structural test: code-splitting discipline for PersonasPage's route surfaces.
 *
 * PersonasPage.tsx is the always-eagerly-loaded app shell — anything it
 * imports at module scope ships in the index chunk, not a lazy chunk. It
 * currently routes ~21 page-level surfaces (editor, build, teams sub-pages,
 * plugin pages, deployment panels, ...) exclusively through
 * `lazyRetry(() => import('...'))`. Nothing catches a regression where a new
 * route, or an accidental "just import it directly, it's easier" edit,
 * reintroduces a static top-of-file import of one of these surfaces — no
 * lint rule reasons about "is this module also rendered as a route element."
 *
 * Invariants asserted (see file header of PersonasPage.tsx for the lazyRetry
 * rationale — raw `React.lazy` caches a rejected import promise forever):
 *   1. PersonasPage declares at least as many `lazyRetry(() => import(...))`
 *      route surfaces as it does today (21). A route addition that bypasses
 *      lazy() would otherwise leave this count flat while a new static
 *      import appears (invariant 2 below) — the count floor makes "someone
 *      just deleted a lazy route and inlined it" visible too.
 *   2. No static (module-scope `import ... from '...'`) specifier in the file
 *      is identical to a specifier already reached via `lazyRetry(() =>
 *      import(...))` — this catches "the same page got imported twice, once
 *      lazily and once statically" (the static one wins for bundling
 *      purposes and silently bloats the index chunk).
 *   3. No static import specifier's final path segment ends in `Page` — by
 *      convention every route-level page component in this codebase is named
 *      `*Page` (GoalsPage, KPIsPage, DevToolsPage, ...), so a static import
 *      of a `*Page` module is a strong signal that a new route surface was
 *      wired in eagerly instead of through `lazyRetry`.
 *
 * If this test fails: static page imports bloat the index chunk that loads
 * before first paint. Convert the offending import to
 * `lazyRetry(() => import('<path>'))` and render it behind a `<Suspense>`
 * boundary, matching the existing route branches in `renderContent()`.
 */
import { describe, it, expect } from "vitest";

const personasPageSource = Object.values(
  import.meta.glob<string>("../../features/personas/PersonasPage.tsx", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
)[0] as unknown as string;

if (!personasPageSource) {
  throw new Error(
    "personas-page-code-splitting.test.ts: could not load src/features/personas/PersonasPage.tsx source via import.meta.glob — did the file move?",
  );
}

// Minimum current lazy-route count. Bump this number UP when adding a new
// lazyRetry-wrapped route; never bump it down without removing an actual
// route surface (see invariant 1 above).
const MIN_LAZY_ROUTE_COUNT = 21;

// `lazyRetry(() => import('<path>').then(...))` or plain
// `lazyRetry(() => import('<path>'))` — capture the import specifier.
const LAZY_IMPORT_RE = /lazyRetry\(\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/g;

// Static ES import declarations: `import ... from '<path>';`. Deliberately
// requires `from` so it does NOT match the function-scoped dynamic
// `import('<path>')` calls used for secondary-data fetches and idle
// prefetching further down the file — those are legitimately dynamic, not
// module-scope static imports, and are out of scope for this invariant.
const STATIC_IMPORT_RE = /^import\s[\s\S]*?\sfrom\s+['"]([^'"]+)['"];?\s*$/gm;

function extractAll(re: RegExp, source: string): string[] {
  const specifiers: string[] = [];
  let m: RegExpExecArray | null;
  const flagged = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = flagged.exec(source)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

const lazyImportSpecifiers = extractAll(LAZY_IMPORT_RE, personasPageSource);
const staticImportSpecifiers = extractAll(STATIC_IMPORT_RE, personasPageSource);

describe("structural: PersonasPage code-splitting discipline", () => {
  it(`declares at least ${MIN_LAZY_ROUTE_COUNT} lazyRetry-wrapped route surfaces`, () => {
    expect(
      lazyImportSpecifiers.length,
      `Expected >= ${MIN_LAZY_ROUTE_COUNT} 'lazyRetry(() => import(...))' route declarations in PersonasPage.tsx, found ${lazyImportSpecifiers.length}:\n` +
        lazyImportSpecifiers.map((s) => `  - ${s}`).join("\n"),
    ).toBeGreaterThanOrEqual(MIN_LAZY_ROUTE_COUNT);
  });

  it("no static import duplicates a module already loaded via lazyRetry", () => {
    const lazySet = new Set(lazyImportSpecifiers);
    const collisions = staticImportSpecifiers.filter((s) => lazySet.has(s));
    expect(
      collisions,
      `Static top-of-file import(s) point at a module already lazy-loaded via lazyRetry — static page imports bloat the index chunk:\n` +
        collisions.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([]);
  });

  it("no static import targets a '*Page' module (route pages must be lazy-loaded)", () => {
    const pageStaticImports = staticImportSpecifiers.filter((s) => /Page$/.test(s));
    expect(
      pageStaticImports,
      `Static top-of-file import(s) target a '*Page' module — by convention route-level pages are lazy-loaded via 'lazyRetry(() => import(...))', not imported statically. Static page imports bloat the index chunk:\n` +
        pageStaticImports.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([]);
  });
});
