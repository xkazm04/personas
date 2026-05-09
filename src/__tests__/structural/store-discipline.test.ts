/**
 * Structural test: state-management slice discipline.
 *
 * Codifies invariants identified in /architect run 2026-05-09 that are too
 * cross-file for a single-AST lint rule to catch. The lint rule
 * `custom/no-whole-store-subscription` covers the call-site invariant; this
 * test covers the slice-author invariants.
 *
 * Invariants asserted:
 *   1. Every slice file (src/stores/slices/**\/*.ts) exports a `createXxxSlice`
 *      factory typed as `StateCreator<Store, [], [], XxxSlice>`.
 *   2. No two slice interfaces in the same domain directory declare the same
 *      property name. (Within-directory check is a tractable proxy for the
 *      true within-store check; cross-directory collisions are unlikely
 *      given the slice-prefix discipline.)
 *
 * If this test fails, see:
 *   - .claude/codebase-stack.md § "State management: load-bearing patterns"
 *   - $VAULT/Architect/strong-patterns.md § "Zustand consumption discipline"
 */
import { describe, it, expect } from "vitest";

const allSliceFiles = import.meta.glob<string>(
  "../../stores/slices/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
);
// Filter out test files (Vite glob doesn't support extglob negation).
const sliceModules = Object.fromEntries(
  Object.entries(allSliceFiles).filter(([path]) => !/\.test\.ts$/.test(path)),
);

interface SliceInfo {
  path: string;
  source: string;
  interfaceName: string | null;
  factoryName: string | null;
  hasStateCreatorTyping: boolean;
  propertyNames: string[];
  /** True if the file declares a slice (interface XxxSlice OR createXxxSlice export). */
  isSlice: boolean;
}

function parseSlice(path: string, source: string): SliceInfo {
  const interfaceMatch = source.match(/export\s+interface\s+(\w+Slice)\s*\{/);
  const interfaceName = interfaceMatch?.[1] ?? null;

  // Match factory declarations on a single line OR with a multi-line generic
  // signature. We just need to confirm the StateCreator<...> typing appears
  // attached to the factory const declaration.
  const factoryMatch = source.match(
    /export\s+const\s+(create\w+Slice)\s*:\s*StateCreator</,
  );
  const factoryName = factoryMatch?.[1] ?? null;
  const hasStateCreatorTyping = factoryMatch !== null;
  // Either an interface XxxSlice or a createXxxSlice factory makes this a slice
  // file. Helper modules under slices/ that expose neither (e.g. runLifecycle,
  // deployTarget) are excluded from the discipline checks.
  const hasFactoryConst = /export\s+const\s+create\w+Slice\b/.test(source);
  const isSlice = interfaceName !== null || hasFactoryConst;

  const propertyNames: string[] = [];
  if (interfaceMatch) {
    const start = source.indexOf("{", interfaceMatch.index!);
    let depth = 1;
    let i = start + 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = source.slice(start + 1, i - 1);
    // Extract property declarations at the first indentation level only.
    // Match `<indent><word>(?:\?)?<spaces>:` where <indent> is exactly 2 spaces
    // (the canonical convention in this codebase). Deeper indents are nested
    // type bodies, not slice properties.
    const propRe = /^ {2}(\w+)\??\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = propRe.exec(body)) !== null) {
      propertyNames.push(m[1]);
    }
  }

  return {
    path,
    source,
    interfaceName,
    factoryName,
    hasStateCreatorTyping,
    propertyNames,
    isSlice,
  };
}

const allFiles: SliceInfo[] = Object.entries(sliceModules).map(([path, source]) =>
  parseSlice(path, source as unknown as string),
);
const slices = allFiles.filter((s) => s.isSlice);

describe("structural: state-management slice discipline", () => {
  it("discovers ≥30 slice files (sanity check)", () => {
    expect(slices.length).toBeGreaterThanOrEqual(30);
  });

  it("every slice file exports a createXxxSlice factory typed as StateCreator", () => {
    const failures = slices.filter((s) => !s.hasStateCreatorTyping);
    expect(
      failures,
      `Slices missing the canonical 'StateCreator<Store, [], [], XxxSlice>' typing on a 'export const createXxxSlice' factory:\n` +
        failures.map((f) => `  - ${f.path}`).join("\n"),
    ).toEqual([]);
  });

  it("no two slices in the same directory declare the same property name", () => {
    const byDirectory: Record<string, SliceInfo[]> = {};
    for (const slice of slices) {
      const dirMatch = slice.path.match(/slices\/([^/]+)\//);
      const dir = dirMatch ? dirMatch[1] : "(root)";
      (byDirectory[dir] ??= []).push(slice);
    }

    const collisions: string[] = [];
    for (const [dir, dirSlices] of Object.entries(byDirectory)) {
      const ownerByKey: Record<string, string[]> = {};
      for (const slice of dirSlices) {
        const owner = slice.interfaceName ?? slice.path;
        for (const key of slice.propertyNames) {
          (ownerByKey[key] ??= []).push(owner);
        }
      }
      for (const [key, owners] of Object.entries(ownerByKey)) {
        if (owners.length > 1) {
          collisions.push(
            `[${dir}] property '${key}' declared by: ${owners.join(", ")}`,
          );
        }
      }
    }

    expect(
      collisions,
      `Slice property-name collisions within a domain (later spread wins at runtime; silent state clobber):\n  ${collisions.join("\n  ")}`,
    ).toEqual([]);
  });
});
