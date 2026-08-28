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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act, waitFor, screen, fireEvent } from "@testing-library/react";

import {
  ARCHETYPE_TRAITS,
  CORE_ICONS,
  CONFLICT_STYLES,
  CONFLICT_DIRECTIVE,
  EFFORT_TIERS,
  MODEL_TIERS,
  modelTier,
  TRAIT_AXES,
  TRAIT_CATALOG,
  traitById,
} from "../catalog";
import { ARCHETYPE_GLYPHS } from "../archetypeGlyphData";
import { MentalityCard } from "../MentalityCard";
import { EFFORT_LEVELS, EFFORT_OPTIONS } from "@/lib/models/modelCatalog";

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
    // modelCatalog owns the vocabulary the backend is wired to; EFFORT_TIERS is
    // now DERIVED from it, so this pins the derivation rather than a hand-typed
    // copy. Drift here would mean the modal offers a level the engine cannot
    // receive (or hides one it can).
    expect(EFFORT_TIERS.map((e) => e.id)).toEqual([...EFFORT_LEVELS]);
  });

  it("labels every effort tier through the app-wide i18n key, not its own copy", () => {
    // The hand-typed copy had drifted: it called `xhigh` "Max" in this modal
    // while the shared vocabulary's label key held the raw id, so the same
    // level read two different ways inside one app.
    expect(EFFORT_TIERS.map((e) => e.labelKey)).toEqual(EFFORT_OPTIONS.map((o) => o.labelKey));
  });

  it("carries a blurb for every effort tier the vocabulary defines", () => {
    // Blurbs are this surface's own copy, keyed by id in a separate map — a
    // level added upstream must not arrive with an empty tooltip.
    expect(EFFORT_TIERS.filter((e) => !e.blurb).map((e) => e.id)).toEqual([]);
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

  it("gives every model tier the icon and prompt word it used to duplicate", () => {
    // The three tiers were enumerated three times — catalog labels, ConfigTiles'
    // MODEL_ICON map, and a ternary inside usePersonaCore's augmentation — and
    // only the catalog was under test, so a fourth tier would have shipped
    // iconless and with the wrong prompt word.
    const incomplete = MODEL_TIERS.filter((m) => !m.icon || !m.promptWord).map((m) => m.id);
    expect(incomplete).toEqual([]);
  });

  it("carries a relative-cost signal on every model tier, ascending with capability", () => {
    // Picking a model is the biggest spend lever on this screen, and the tiles
    // used to describe capability only ("Deepest reasoning...") with no number
    // to trade it against. A tier added without a multiple would ship a blank
    // chip; one added out of order would tell the user the wrong thing.
    const costs = MODEL_TIERS.map((m) => m.relativeCost);
    expect(costs.every((c) => Number.isFinite(c) && c >= 1)).toBe(true);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(costs[0]).toBe(1);
  });

  it("resolves an unknown model tier to a real tier rather than undefined", () => {
    expect(modelTier("sonnet").id).toBe("sonnet");
    expect(modelTier("nope" as never).promptWord).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// Off-screen avatars: the Mentality column lists nine archetypes in a 64vh
// scroller and only ~3 are visible, so mounting every glyph eagerly paints
// hundreds of animated paths (and a light-theme CSS rule per colour each) for
// content nobody can see.
// --------------------------------------------------------------------------
describe("MentalityCard avatar deferral", () => {
  const archetype = {
    id: "analyst", name: "Analyst", tagline: "Argues from evidence",
    icon: "LineChart", color: "#60a5fa", recipeAffinity: [], persona: {},
  };

  let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

  beforeEach(() => {
    trigger = null;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { trigger = cb; }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  // MotionizedGlyph is the only thing on this card that emits an inline <style>
  // (its keyframes + per-colour light-theme overrides). Counting <path> alone
  // would not discriminate — the lucide fallback and the trait strip draw paths
  // of their own, which is exactly how this assertion first passed for the
  // wrong reason.
  const glyphMounted = (c: HTMLElement) => c.querySelectorAll("svg style").length;

  it("mounts no glyph until the card nears the viewport, then mounts it", () => {
    // The fixture must actually HAVE a glyph, or "nothing mounted" would be
    // true no matter what the component did.
    const paths = ARCHETYPE_GLYPHS[archetype.id]?.data.length ?? 0;
    expect(paths).toBeGreaterThan(0);

    const { container } = render(
      <MentalityCard archetype={archetype} active={false} onSelect={() => {}} />,
    );
    expect(glyphMounted(container)).toBe(0);

    act(() => { trigger?.([{ isIntersecting: true }]); });
    expect(glyphMounted(container)).toBe(1);
    const glyphSvg = container.querySelector("style")!.closest("svg")!;
    expect(glyphSvg.querySelectorAll("path").length).toBe(paths);
  });

  it("keeps the glyph mounted after the card scrolls away", () => {
    // Unmounting on scroll-away would re-pay the mount cost and re-fire the
    // reveal on every pass through the list.
    const { container } = render(
      <MentalityCard archetype={archetype} active={false} onSelect={() => {}} />,
    );
    act(() => { trigger?.([{ isIntersecting: true }]); });
    const mounted = container.querySelectorAll("path").length;
    expect(glyphMounted(container)).toBe(1);
    act(() => { trigger?.([{ isIntersecting: false }]); });
    expect(glyphMounted(container)).toBe(1);
    expect(container.querySelectorAll("path").length).toBe(mounted);
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

  it("keeps every colour literal in catalog.ts", () => {
    // catalog.ts owns ACCENT, the five axis colours and the three control
    // accents. Four call sites used to write raw hex instead, three of them
    // re-using an axis colour for an unrelated concept and one spelling
    // ACCENT a third way, so changing a colour meant grepping call sites and
    // guessing which uses of a hex meant the same thing.
    const offenders = sources.flatMap((f) => {
      if (f === "catalog.ts" || f === "archetypeGlyphData.ts") return [];
      const src = readFileSync(path.join(dir, f), "utf8");
      return src.split("\n").flatMap((line, i) => {
        const code = line.trimStart();
        if (code.startsWith("*") || code.startsWith("//")) return [];
        return /#[0-9a-fA-F]{3,8}\b/.test(line) ? [`${f}:${i + 1}`] : [];
      });
    });
    expect(offenders).toEqual([]);
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

  it("hands back the hand-picked traits a mentality replaced", async () => {
    // The mentality cards sit one click from the trait grid in the same modal,
    // carry no warning, and replace the WHOLE trait set. A user who spent a
    // minute assembling traits and then clicked a card out of curiosity lost
    // all of it with no way back.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleTrait("terse"));
    act(() => result.current.toggleTrait("actionable"));
    expect(result.current.discardedTraits).toBeNull();

    const guardian = shipped.find((a) => a.id === "guardian")!;
    act(() => result.current.applyPreset(guardian as never));
    expect(result.current.state.traits).toEqual(ARCHETYPE_TRAITS.guardian);
    expect(result.current.discardedTraits).toEqual(["terse", "actionable"]);

    act(() => result.current.restoreTraits());
    expect(result.current.state.traits).toEqual(["terse", "actionable"]);
    // The archetype was clicked on purpose — only the traits come back.
    expect(result.current.state.archetypeId).toBe("guardian");
    expect(result.current.discardedTraits).toBeNull();
  });

  it("offers nothing to restore when the preset replaced an empty set", async () => {
    // The affordance is driven by this value, so a non-null here would put a
    // permanent dead "restore" control in the column.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const guardian = shipped.find((a) => a.id === "guardian")!;
    act(() => result.current.applyPreset(guardian as never));
    expect(result.current.discardedTraits).toBeNull();
  });

  it("withdraws the restore offer once the user edits the new trait set", async () => {
    // Restoring after an edit would silently undo THAT edit too.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleTrait("terse"));
    const guardian = shipped.find((a) => a.id === "guardian")!;
    act(() => result.current.applyPreset(guardian as never));
    expect(result.current.discardedTraits).toEqual(["terse"]);

    act(() => result.current.toggleTrait("ships-fast"));
    expect(result.current.discardedTraits).toBeNull();
    act(() => result.current.restoreTraits());
    expect(result.current.state.traits).toContain("ships-fast");
  });

  it("drops the restore offer when the core is reset", async () => {
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleTrait("terse"));
    const guardian = shipped.find((a) => a.id === "guardian")!;
    act(() => result.current.applyPreset(guardian as never));
    act(() => result.current.reset());

    expect(result.current.discardedTraits).toBeNull();
    expect(result.current.configured).toBe(false);
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

// --------------------------------------------------------------------------
// Reading order: the preset column leads.
// --------------------------------------------------------------------------
import { PersonaCoreCodex } from "../PersonaCoreCodex";

describe("PersonaCoreCodex column order", () => {
  it("puts Mentality (the one-click preset) ahead of hand assembly", () => {
    // A mentality card seeds disposition, conflict style and five dominant
    // traits at once. With it third, a first-timer read the modal backwards —
    // 20 trait toggles and three tile groups by hand, then the shortcut.
    const core = {
      state: { traits: [] as string[], disposition: 0.4, conflictStyle: null, model: "sonnet", effort: "medium", archetypeId: null },
      archetypes: [], loadFailed: false, discardedTraits: null,
      toggleTrait: () => {}, setDisposition: () => {}, setConflict: () => {},
      setModel: () => {}, setEffort: () => {}, applyPreset: () => {},
      retryLoad: () => {}, restoreTraits: () => {},
    } as unknown as Parameters<typeof PersonaCoreCodex>[0]["core"];

    const { container } = render(<PersonaCoreCodex core={core} />);
    // SectionHeader renders an <h3> per column — the same structure a screen
    // reader walks, so DOM order here IS reading order.
    const order = [...container.querySelectorAll("h3")].map((el) => el.textContent?.trim() ?? "");

    const mentality = order.findIndex((h) => /mentality/i.test(h));
    const character = order.findIndex((h) => /character/i.test(h));
    const configuration = order.findIndex((h) => /configuration/i.test(h));

    // Instrument check — all three must be found, or the ordering assertions
    // below compare -1 against -1 and pass while measuring nothing.
    expect([mentality, character, configuration].every((i) => i >= 0)).toBe(true);
    expect(mentality).toBeLessThan(character);
    expect(character).toBeLessThan(configuration);
  });
});

// --------------------------------------------------------------------------
// Two a11y contracts: mutually-exclusive choices vs a genuine toggle.
// --------------------------------------------------------------------------
import { ConflictTiles, EffortMeter, ModelTiles } from "../ConfigTiles";

describe("config tile semantics", () => {
  const makeCore = (over: Record<string, unknown> = {}) => ({
    state: { model: "sonnet", effort: "medium", conflictStyle: null, traits: [] as string[] },
    setModel: vi.fn(), setEffort: vi.fn(), setConflict: vi.fn(),
    ...over,
  } as unknown as Parameters<typeof ModelTiles>[0]["core"]);

  it("announces model as one choice with a current value, not three toggles", () => {
    // aria-pressed told a screen reader these were independent toggles.
    const { container } = render(<ModelTiles core={makeCore()} />);
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1);
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(MODEL_TIERS.length);
    expect(container.querySelectorAll("[aria-pressed]").length).toBe(0);

    const checked = [...radios].filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked.length).toBe(1);
  });

  it("keeps exactly one model tile in the tab order", () => {
    const { container } = render(<ModelTiles core={makeCore()} />);
    const stops = [...container.querySelectorAll('[role="radio"]')]
      .filter((r) => r.getAttribute("tabindex") === "0");
    expect(stops.length).toBe(1);
  });

  it("moves the model selection with the arrow keys", () => {
    const setModel = vi.fn();
    const { container } = render(<ModelTiles core={makeCore({ setModel })} />);
    const radios = [...container.querySelectorAll('[role="radio"]')];
    const current = radios.find((r) => r.getAttribute("aria-checked") === "true")!;

    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(setModel).toHaveBeenCalledTimes(1);
    const next = MODEL_TIERS[MODEL_TIERS.findIndex((m) => m.id === "sonnet") + 1]!.id;
    expect(setModel).toHaveBeenCalledWith(next);
  });

  it("announces effort the same way", () => {
    const { container } = render(<EffortMeter core={makeCore()} />);
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1);
    expect(container.querySelectorAll('[role="radio"]').length).toBe(EFFORT_TIERS.length);
    expect(container.querySelectorAll("[aria-pressed]").length).toBe(0);
  });

  it("leaves conflict style as a toggle, because it genuinely is one", () => {
    // Clicking the active style CLEARS it (setConflict's same-id handler),
    // which is toggle behaviour and would be a lie under radio semantics.
    const { container } = render(<ConflictTiles core={makeCore()} />);
    expect(container.querySelectorAll('[role="radio"]').length).toBe(0);
    expect(container.querySelectorAll("[aria-pressed]").length).toBe(CONFLICT_STYLES.length);
  });
});

// --------------------------------------------------------------------------
// What the surface reports about itself.
// --------------------------------------------------------------------------
import { personaCoreSelectionLabel } from "../usePersonaCore";
import { PersonaCoreModal } from "../PersonaCoreModal";
import { setAnalyticsSink, noopSink, type InteractionEvent } from "@/lib/analytics/sink";

describe("persona-core selection label", () => {
  const base = {
    archetypeId: null, disposition: 0.4, conflictStyle: null,
    traits: [] as string[], model: "sonnet", effort: "medium",
  } as Parameters<typeof personaCoreSelectionLabel>[0];

  it("reports an untouched core without inventing a selection", () => {
    expect(personaCoreSelectionLabel(base)).toBe(
      "archetype=none;traits=0;trait_ids=none;conflict=none;model=sonnet;effort=medium",
    );
  });

  it("is stable under click order, so the same choice is one bucket", () => {
    const a = personaCoreSelectionLabel({ ...base, traits: ["terse", "actionable"] });
    const b = personaCoreSelectionLabel({ ...base, traits: ["actionable", "terse"] });
    expect(a).toBe(b);
  });

  it("carries only catalog identifiers — no user-authored content", () => {
    // The privacy contract the analytics module states for itself. Every token
    // in the label must be an id this repo ships, a count, or "none".
    const label = personaCoreSelectionLabel({
      ...base, archetypeId: "guardian", conflictStyle: "analyst",
      traits: ["terse", "quality-gate"], model: "opus", effort: "high",
    });
    const values = label.split(";").map((p) => p.split("=")[1]!);
    const known = new Set<string>([
      ...Object.keys(ARCHETYPE_TRAITS), ...TRAIT_CATALOG.map((t) => t.id),
      ...CONFLICT_STYLES.map((c) => c.id), ...MODEL_TIERS.map((m) => m.id),
      ...EFFORT_TIERS.map((e) => String(e.id)), "none",
    ]);
    const unknown = values.flatMap((v) =>
      v.split("|").filter((tok) => !known.has(tok) && !/^\d+$/.test(tok)),
    );
    expect(unknown).toEqual([]);
  });
});

describe("PersonaCoreModal analytics", () => {
  const events: InteractionEvent[] = [];

  beforeEach(() => {
    events.length = 0;
    listArchetypes.mockReset();
    listArchetypes.mockResolvedValue(CATALOG);
    setAnalyticsSink({ ...noopSink, interaction: (e) => { events.push(e); } });
  });
  afterEach(() => setAnalyticsSink(noopSink));

  it("records the settled selection when the user closes the modal", async () => {
    // Before this, every choice left the component tree only as prose folded
    // into the build intent, so nothing downstream could answer which
    // archetypes or traits people actually pick.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggleTrait("terse"));

    const onClose = vi.fn();
    render(<PersonaCoreModal core={result.current} isOpen onClose={onClose} />);
    fireEvent.click(screen.getByTestId("persona-core-done"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.category).toBe("persona_core");
    expect(events[0]!.action).toBe("configured");
    expect(events[0]!.label).toContain("trait_ids=terse");
  });

  it("distinguishes an ABANDONED open from a configured one", async () => {
    // An open the user backed out of is the signal that says the surface is
    // confusing; collapsing it into "configured" would hide exactly that.
    const { result } = renderHook(() => usePersonaCore("build-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    render(<PersonaCoreModal core={result.current} isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("persona-core-done"));

    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("dismissed");
  });
});
