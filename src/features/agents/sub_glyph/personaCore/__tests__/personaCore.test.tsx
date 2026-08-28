/** personaCore — catalog-integrity + augmentation-contract tests.
 *
 *  The integrity block derives its expectations from the SHIPPED archetype
 *  catalog (`scripts/templates/_archetypes.json`, which the Rust side embeds
 *  via `include_str!` in `engine/src/archetype_catalog.rs`) rather than from
 *  another list in this folder. Three hand-maintained lists here have to agree
 *  with that one file — ARCHETYPE_TRAITS, ARCHETYPE_GLYPHS and CONFLICT_STYLES
 *  — and nothing but this test compares them: an archetype added to the JSON
 *  silently loses its preset traits (applyPreset falls through to `prev.traits`)
 *  and its avatar (MentalityCard falls back to a lucide glyph), with no error
 *  anywhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, act, waitFor, screen } from "@testing-library/react";

import {
  ARCHETYPE_TRAITS,
  CORE_ICONS,
  CONFLICT_STYLES,
  CONFLICT_DIRECTIVE,
  EFFORT_TIERS,
  MODEL_TIERS,
  TRAIT_AXES,
  TRAIT_CATALOG,
  traitById,
} from "../catalog";
import { ARCHETYPE_GLYPHS } from "../archetypeGlyphData";
import { EFFORT_LEVELS } from "@/lib/models/modelCatalog";

// --------------------------------------------------------------------------
// Ground truth: the catalog the backend actually serves.
// --------------------------------------------------------------------------
interface ShippedArchetype {
  id: string;
  name: string;
  icon: string;
  color: string;
  persona?: { core?: { conflictStyle?: string; riskTolerance?: number } };
}

const shipped: ShippedArchetype[] = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "scripts/templates/_archetypes.json"), "utf8"),
).archetypes;

describe("persona-core catalog integrity", () => {
  it("reads a non-empty shipped archetype catalog (instrument check)", () => {
    expect(shipped.length).toBeGreaterThan(0);
  });

  it("gives every shipped archetype a preset trait set", () => {
    const missing = shipped.filter((a) => !ARCHETYPE_TRAITS[a.id]).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("gives every shipped archetype an avatar glyph", () => {
    const missing = shipped.filter((a) => !ARCHETYPE_GLYPHS[a.id]).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("has no preset entry for an archetype that no longer ships", () => {
    const ids = new Set(shipped.map((a) => a.id));
    expect(Object.keys(ARCHETYPE_TRAITS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("resolves every trait id referenced by a preset", () => {
    const dangling = Object.entries(ARCHETYPE_TRAITS).flatMap(([archetype, ids]) =>
      ids.filter((id) => !traitById(id)).map((id) => `${archetype}:${id}`),
    );
    expect(dangling).toEqual([]);
  });

  it("places every trait on a declared axis", () => {
    const axes = new Set(TRAIT_AXES.map((a) => a.id));
    expect(TRAIT_CATALOG.filter((t) => !axes.has(t.axis)).map((t) => t.id)).toEqual([]);
  });

  it("knows every conflict style the shipped archetypes select", () => {
    const known = new Set(CONFLICT_STYLES.map((c) => c.id));
    const unknown = shipped
      .map((a) => a.persona?.core?.conflictStyle)
      .filter((c): c is string => !!c && !known.has(c));
    expect(unknown).toEqual([]);
  });

  it("carries a directive for every conflict style the UI offers", () => {
    expect(CONFLICT_STYLES.filter((c) => !CONFLICT_DIRECTIVE[c.id]).map((c) => c.id)).toEqual([]);
  });

  it("keeps its effort tiers in step with the app-wide effort vocabulary", () => {
    // catalog.ts re-enumerates effort levels with its own labels; modelCatalog
    // owns the vocabulary the backend is wired to. Drift here means the modal
    // offers a level the engine cannot receive (or hides one it can).
    expect(EFFORT_TIERS.map((e) => e.id)).toEqual([...EFFORT_LEVELS]);
  });

  it("maps exactly the archetype icons the shipped catalog uses", () => {
    // Two-sided on purpose. A missing entry is invisible at runtime (coreIcon
    // falls back to Sparkles, so a new archetype silently wears the wrong
    // glyph); a surplus entry is dead weight that drags an unused lucide icon
    // into the chunk — which is how five Foundry-era entries survived here.
    const used = [...new Set(shipped.map((a) => a.icon))].sort();
    expect(Object.keys(CORE_ICONS).sort()).toEqual(used);
  });

  it("offers each model tier exactly once", () => {
    const ids = MODEL_TIERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --------------------------------------------------------------------------
// Theming: an inline fill is unreachable by the light-theme overrides.
// --------------------------------------------------------------------------
describe("persona-core theming", () => {
  const dir = path.resolve(process.cwd(), "src/features/agents/sub_glyph/personaCore");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  it("reads the persona-core sources (instrument check)", () => {
    // A file walk that visits nothing passes every assertion below by default,
    // which is the exact way this kind of gate rots into decoration.
    expect(sources.length).toBeGreaterThan(5);
  });

  it("paints no literal white through an inline style", () => {
    // `style={{ background: "rgba(255,255,255,…)" }}` wins the cascade outright,
    // so `[data-theme^="light"]` can never override it and the surface goes
    // white-on-white in light themes. ESLint's colour rules only read Tailwind
    // class names, so nothing else in the toolchain sees this.
    const offenders = sources.flatMap((f) => {
      const src = readFileSync(path.join(dir, f), "utf8");
      return src.split("\n").flatMap((line, i) =>
        /rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(line) && !line.trimStart().startsWith("*")
          ? [`${f}:${i + 1}`]
          : [],
      );
    });
    expect(offenders).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The hook: what the surface actually produces + how it fails.
// --------------------------------------------------------------------------
const listArchetypes = vi.fn();
vi.mock("@/api/archetypes", () => ({ listArchetypes: () => listArchetypes() }));

import { usePersonaCore } from "../usePersonaCore";

const CATALOG = { archetypes: shipped, memory_strategies: [] };

describe("usePersonaCore", () => {
  beforeEach(() => {
    listArchetypes.mockReset();
    listArchetypes.mockResolvedValue(CATALOG);
  });

  it("augments nothing until the user configures something", async () => {
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.configured).toBe(false);
    expect(result.current.launchAugmentation()).toBe("");
  });

  it("emits the conflict directive and one line per selected trait", async () => {
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setConflict("analyst"));
    act(() => result.current.toggleTrait("terse"));

    const out = result.current.launchAugmentation();
    expect(out).toContain(CONFLICT_DIRECTIVE.analyst);
    expect(out).toContain(traitById("terse")!.directive);
    expect(out).toContain("reasoning effort: medium");
  });

  it("drops a trait's directive when the trait is toggled back off", async () => {
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleTrait("terse"));
    act(() => result.current.toggleTrait("terse"));
    expect(result.current.launchAugmentation()).not.toContain(traitById("terse")!.directive);
  });

  it("goes back to unconfigured when every choice is undone", async () => {
    // `configured` gates BOTH the augmentation and the badge label. Latching it
    // on the first click meant a user who toggled a trait on and off still
    // shipped "Disposition: balanced" + "Model tier: Sonnet" into the intent.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setConflict("analyst"));
    expect(result.current.configured).toBe(true);
    act(() => result.current.setConflict("analyst"));

    expect(result.current.configured).toBe(false);
    expect(result.current.launchAugmentation()).toBe("");
  });

  it("seeds a preset's dominant traits when a mentality is picked", async () => {
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const guardian = shipped.find((a) => a.id === "guardian")!;
    act(() => result.current.applyPreset(guardian as never));
    expect(result.current.state.traits).toEqual(ARCHETYPE_TRAITS.guardian);
    expect(result.current.state.archetypeId).toBe("guardian");
  });

  it("keeps the configured core when a build session STARTS", async () => {
    // resetKey is the build-session id: null while composing, an id once the
    // build launches. The launched intent carries the core's directives, so the
    // badge must keep showing them for the (locked) build panel.
    const { result, rerender } = renderHook(({ key }: { key: string | null }) => usePersonaCore(key), {
      initialProps: { key: null as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggleTrait("terse"));
    expect(result.current.configured).toBe(true);

    rerender({ key: "session-1" });
    expect(result.current.configured).toBe(true);
    expect(result.current.state.traits).toEqual(["terse"]);
  });

  it("resets the core when the surface returns to compose", async () => {
    const { result, rerender } = renderHook(({ key }: { key: string | null }) => usePersonaCore(key), {
      initialProps: { key: "session-1" as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggleTrait("terse"));

    rerender({ key: null });
    expect(result.current.configured).toBe(false);
    expect(result.current.state.traits).toEqual([]);
  });

  it("spells a failed catalog fetch differently from an empty one", async () => {
    listArchetypes.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => usePersonaCore("build-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.archetypes).toEqual([]);
    expect(result.current.loadFailed).toBe(true);
  });

  it("clears the failure when the retry succeeds", async () => {
    listArchetypes.mockRejectedValueOnce(new Error("ipc down"));
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.archetypes.length).toBe(shipped.length));
    expect(result.current.loadFailed).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Structure the trait palette exposes to assistive tech.
// --------------------------------------------------------------------------
import { AxisTraitGrid } from "../TraitGrid";

describe("AxisTraitGrid accessibility", () => {
  const core = {
    state: { traits: [] as string[] },
    toggleTrait: () => {},
  } as unknown as Parameters<typeof AxisTraitGrid>[0]["core"];

  it("groups the trait toggles by axis and names each group", () => {
    render(<AxisTraitGrid core={core} />);
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBe(TRAIT_AXES.length);
    for (const axis of TRAIT_AXES) {
      expect(screen.getByRole("group", { name: new RegExp(axis.short, "i") })).toBeTruthy();
    }
  });

  it("exposes every trait as a pressable toggle", () => {
    render(<AxisTraitGrid core={core} />);
    expect(screen.getAllByRole("button").length).toBe(TRAIT_CATALOG.length);
  });
});
