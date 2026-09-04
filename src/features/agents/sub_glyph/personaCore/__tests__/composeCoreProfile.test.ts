/** composeManifestSeed — codex state → MANIFEST SEED PROSE mapping contract.
 *
 *  What these tests pin, after the agent-manifest rebase turned
 *  `personas.core_profile` from a 7-dial JSON blob into the manifest mirror:
 *   • the relevance gate (model / effort / conflict style alone never compose —
 *     none of them puts a word in the manifest);
 *   • NO DIAL KEY IS EVER EMITTED. This is the whole point of the rewrite: the
 *     Rust seeder reads prose keys only, and a dial written here would be a
 *     number in the persona's permanent record that nothing consumes;
 *   • archetype base semantics: an accepted archetype carries its authored
 *     prose, with persona-level identity/voice objects flattened in;
 *   • trait directives append into `principles`, in selection order, deduped;
 *   • archetype-less composition overlays the design payload's own prose so
 *     partial codex use never erases LLM-authored words;
 *   • the serialized shape is exactly the key set `render_law_seed` reads.
 */
import { describe, it, expect } from "vitest";
import {
  composeManifestSeed,
  extractDesignSeed,
  narrowManifestSeed,
  type ManifestSeed,
} from "../composeCoreProfile";
import { traitById } from "../catalog";
import type { Archetype, PersonaCoreState } from "../types";

// -- Fixtures ----------------------------------------------------------------

/** Mirrors the shipped guardian entry's payload shape
 *  (`scripts/templates/_archetypes.json`): a `persona.core` that still carries
 *  the legacy dials (the catalog is authored data and was not rewritten), prose
 *  identity/voice OBJECTS at the persona level, persona-level arrays with
 *  `decision_principles` in snake_case. */
const GUARDIAN: Archetype = {
  id: "guardian",
  name: "Guardian",
  tagline: "Nothing ships unverified",
  icon: "ShieldCheck",
  color: "teal",
  recipeAffinity: ["monitoring"],
  persona: {
    core: {
      motivation: "Someone has to be the line that doesn't move.",
      stance: "Nothing ships unverified.",
      northStarCommitment: "Be the reason the product just works.",
      riskTolerance: 0.15,
      speedVsQuality: 0.2,
      conflictStyle: "challenger",
      deference: 0.25,
    },
    identity: {
      role: "Uncompromising quality engineer",
      description: "A senior verifier who treats every finding as evidence.",
    },
    voice: {
      style: "Precise, specific, numbered.",
      output_format: "Numbered findings with severity.",
    },
    principles: ["Verify before trusting", "Every claim carries its evidence"],
    constraints: ["Never auto-resolve findings"],
    decision_principles: ["When uncertain, verify once more"],
  },
};

/** The state `applyPreset(GUARDIAN)` leaves behind: its conflict style and its
 *  preloaded traits. */
function guardianAcceptedState(overrides: Partial<PersonaCoreState> = {}): PersonaCoreState {
  return {
    archetypeId: "guardian",
    conflictStyle: "challenger",
    traits: [],
    model: "sonnet",
    effort: "medium",
    ...overrides,
  };
}

function defaultState(overrides: Partial<PersonaCoreState> = {}): PersonaCoreState {
  return {
    archetypeId: null,
    conflictStyle: null,
    traits: [],
    model: "sonnet",
    effort: "medium",
    ...overrides,
  };
}

const directive = (id: string): string => {
  const t = traitById(id);
  if (!t) throw new Error(`fixture references unknown trait ${id}`);
  return t.directive;
};

/** Every dial key the pre-rebase composer used to emit. None may survive. */
const DIAL_KEYS = ["riskTolerance", "speedVsQuality", "deference", "conflictStyle"];

// -- Relevance gate ----------------------------------------------------------

describe("composeManifestSeed relevance gate", () => {
  it("returns null for the untouched default state", () => {
    expect(composeManifestSeed(defaultState(), null)).toBeNull();
  });

  it("returns null when only model/effort changed (neither reaches the manifest)", () => {
    expect(
      composeManifestSeed(defaultState({ model: "opus", effort: "xhigh" }), null),
    ).toBeNull();
  });

  it("returns null when only the conflict style was chosen", () => {
    // The style is carried as a prose DIRECTIVE in the build intent
    // (`launchAugmentation`), never as a manifest field.
    expect(composeManifestSeed(defaultState({ conflictStyle: "analyst" }), null)).toBeNull();
  });

  it("composes when a trait was toggled", () => {
    const seed = composeManifestSeed(defaultState({ traits: ["terse"] }), null);
    expect(seed).not.toBeNull();
    expect(seed!.principles).toEqual([directive("terse")]);
  });
});

// -- No dials, ever ----------------------------------------------------------

describe("composeManifestSeed emits no dials", () => {
  it("omits every dial key even when the archetype's authored core carries them", () => {
    const seed = composeManifestSeed(guardianAcceptedState(), GUARDIAN)!;
    const wire = JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
    for (const key of DIAL_KEYS) expect(key in wire).toBe(false);
  });

  it("omits every dial key when narrowing a design payload that carries them", () => {
    const seed = narrowManifestSeed({
      motivation: "m",
      riskTolerance: 0.1,
      conflictStyle: "analyst",
    })!;
    const wire = JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
    for (const key of DIAL_KEYS) expect(key in wire).toBe(false);
  });
});

// -- Archetype base ----------------------------------------------------------

describe("composeManifestSeed with an archetype", () => {
  it("carries the archetype's authored prose", () => {
    const seed = composeManifestSeed(guardianAcceptedState(), GUARDIAN)!;
    expect(seed.motivation).toBe("Someone has to be the line that doesn't move.");
    expect(seed.stance).toBe("Nothing ships unverified.");
    expect(seed.northStarCommitment).toBe("Be the reason the product just works.");
  });

  it("flattens persona-level identity/voice objects into prose fields", () => {
    const seed = composeManifestSeed(guardianAcceptedState(), GUARDIAN)!;
    expect(seed.identity).toBe(
      "Uncompromising quality engineer. A senior verifier who treats every finding as evidence.",
    );
    expect(seed.voice).toBe("Precise, specific, numbered.");
    expect(seed.principles).toEqual([
      "Verify before trusting",
      "Every claim carries its evidence",
    ]);
    expect(seed.constraints).toEqual(["Never auto-resolve findings"]);
    expect(seed.decisionPrinciples).toEqual(["When uncertain, verify once more"]);
  });

  it("appends trait directives into principles in selection order, deduped", () => {
    const seed = composeManifestSeed(
      guardianAcceptedState({ traits: ["terse", "evidence-first", "terse"] }),
      GUARDIAN,
    )!;
    expect(seed.principles).toEqual([
      "Verify before trusting",
      "Every claim carries its evidence",
      directive("terse"),
      directive("evidence-first"),
    ]);
  });

  it("does not duplicate a directive the base already states verbatim", () => {
    const archetype: Archetype = {
      ...GUARDIAN,
      persona: {
        ...GUARDIAN.persona,
        principles: [directive("terse")],
      },
    };
    const seed = composeManifestSeed(
      guardianAcceptedState({ traits: ["terse"] }),
      archetype,
    )!;
    expect(seed.principles).toEqual([directive("terse")]);
  });
});

// -- Archetype-less composition ----------------------------------------------

describe("composeManifestSeed without an archetype", () => {
  const designSeed: ManifestSeed = {
    motivation: "LLM-authored motivation.",
    stance: "LLM-authored stance.",
    northStarCommitment: "LLM-authored commitment.",
    identity: "LLM identity.",
    voice: undefined,
    principles: ["LLM principle"],
    constraints: ["LLM constraint"],
    decisionPrinciples: [],
  };

  it("overlays codex traits on the design prose without erasing it", () => {
    const seed = composeManifestSeed(
      defaultState({ conflictStyle: "challenger", traits: ["terse"] }),
      null,
      designSeed,
    )!;
    expect(seed.motivation).toBe("LLM-authored motivation.");
    expect(seed.identity).toBe("LLM identity.");
    expect(seed.principles).toEqual(["LLM principle", directive("terse")]);
    expect(seed.constraints).toEqual(["LLM constraint"]);
  });

  it("falls back to an empty base when no design prose exists", () => {
    const seed = composeManifestSeed(defaultState({ traits: ["terse"] }), null, null)!;
    expect(seed.principles).toEqual([directive("terse")]);
    expect(seed.motivation).toBeUndefined();
    expect(seed.constraints).toEqual([]);
  });
});

// -- Wire shape --------------------------------------------------------------

describe("composed seed wire shape", () => {
  it("serializes only the keys the Rust law seeder reads, omitting empty prose", () => {
    const seed = composeManifestSeed(defaultState({ traits: ["terse"] }), null, null)!;
    const wire = JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual([
      "constraints",
      "decisionPrinciples",
      "principles",
    ]);
    // Every prose field was empty -> undefined -> absent on the wire.
    for (const key of ["identity", "voice", "motivation", "stance", "northStarCommitment"]) {
      expect(key in wire).toBe(false);
    }
  });

  it("opens with `{` so the Rust seeder recognizes it as a legacy core blob", () => {
    // `manifest::legacy_core_json` refuses anything that does not start with
    // `{` (markdown never does), so a seed that is not a JSON OBJECT would be
    // silently ignored and the operator's prose would never reach `# Mandate`.
    const seed = composeManifestSeed(guardianAcceptedState(), GUARDIAN)!;
    expect(JSON.stringify(seed).startsWith("{")).toBe(true);
  });
});

// -- Boundary narrowing ------------------------------------------------------

describe("extractDesignSeed / narrowManifestSeed", () => {
  it("pulls persona.core prose out of a v3-shaped agent_ir", () => {
    const seed = extractDesignSeed({
      persona: { core: { motivation: "m", riskTolerance: 0.1, decision_principles: ["d"] } },
    })!;
    expect(seed.motivation).toBe("m");
    // snake_case decision_principles (v3 authoring) is accepted.
    expect(seed.decisionPrinciples).toEqual(["d"]);
  });

  it("returns null for flat, missing, or malformed payloads", () => {
    expect(extractDesignSeed({ system_prompt: "flat ir" })).toBeNull();
    expect(extractDesignSeed(null)).toBeNull();
    expect(extractDesignSeed("garbage")).toBeNull();
    expect(extractDesignSeed({ persona: { core: [] } })).toBeNull();
  });

  it("drops non-string list members and trims what survives", () => {
    const seed = narrowManifestSeed({
      principles: ["  keep me  ", 7, null, ""],
      identity: "   ",
    })!;
    expect(seed.principles).toEqual(["keep me"]);
    expect(seed.identity).toBeUndefined();
  });
});
