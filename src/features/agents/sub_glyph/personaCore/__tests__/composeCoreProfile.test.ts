/** composeCoreProfile — codex state → typed runtime Core mapping contract.
 *
 *  What these tests pin:
 *   • the Core-relevance gate (model/effort alone never compose — the runtime
 *     Core has no field for them);
 *   • archetype base semantics: an accepted archetype round-trips its authored
 *     `persona.core` dials byte-for-byte, with persona-level identity/voice/
 *     principle arrays flattened in;
 *   • the collapsed disposition slider drives BOTH risk dials only when moved
 *     off its seed (the archetype's authored `riskTolerance`, or the codex
 *     default) — mirroring `applyPreset`'s seeding and the prose bands;
 *   • conflict style overlays verbatim; a cleared style keeps the base's;
 *   • trait directives append into `principles`, in selection order, deduped;
 *   • archetype-less composition overlays the design payload's own core so
 *     partial codex use never erases LLM-authored prose;
 *   • the serialized shape matches the Rust `PersonaCore` serde contract
 *     (camelCase keys, empty optional prose omitted).
 */
import { describe, it, expect } from "vitest";
import type { PersonaCore as CoreProfile } from "@/lib/bindings/PersonaCore";
import {
  composeCoreProfile,
  extractDesignCore,
  narrowCoreProfile,
} from "../composeCoreProfile";
import { DEFAULT_DISPOSITION, traitById } from "../catalog";
import type { Archetype, PersonaCoreState } from "../types";

// -- Fixtures ----------------------------------------------------------------

/** Mirrors the shipped guardian entry's payload shape
 *  (`scripts/templates/_archetypes.json`): 7-dial `persona.core`, prose
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

/** The state `applyPreset(GUARDIAN)` leaves behind: slider seeded from the
 *  archetype's riskTolerance, its conflict style, its preloaded traits. */
function guardianAcceptedState(overrides: Partial<PersonaCoreState> = {}): PersonaCoreState {
  return {
    archetypeId: "guardian",
    disposition: 0.15,
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
    disposition: DEFAULT_DISPOSITION,
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

// -- Core-relevance gate -----------------------------------------------------

describe("composeCoreProfile relevance gate", () => {
  it("returns null for the untouched default state", () => {
    expect(composeCoreProfile(defaultState(), null)).toBeNull();
  });

  it("returns null when only model/effort changed (no Core field carries them)", () => {
    expect(
      composeCoreProfile(defaultState({ model: "opus", effort: "xhigh" }), null),
    ).toBeNull();
  });

  it("composes when only the slider moved", () => {
    const core = composeCoreProfile(defaultState({ disposition: 0.9 }), null);
    expect(core).not.toBeNull();
    expect(core!.riskTolerance).toBe(0.9);
    expect(core!.speedVsQuality).toBe(0.9);
  });
});

// -- Archetype base ----------------------------------------------------------

describe("composeCoreProfile with an archetype", () => {
  it("round-trips an accepted archetype's authored core byte-for-byte on the dials", () => {
    const core = composeCoreProfile(guardianAcceptedState(), GUARDIAN)!;
    expect(core.motivation).toBe("Someone has to be the line that doesn't move.");
    expect(core.stance).toBe("Nothing ships unverified.");
    expect(core.northStarCommitment).toBe("Be the reason the product just works.");
    // Slider untouched (still at its applyPreset seed) → the authored dials
    // stand, including a speedVsQuality DIFFERENT from riskTolerance.
    expect(core.riskTolerance).toBe(0.15);
    expect(core.speedVsQuality).toBe(0.2);
    expect(core.deference).toBe(0.25);
    expect(core.conflictStyle).toBe("challenger");
  });

  it("flattens persona-level identity/voice objects into the Core's prose fields", () => {
    const core = composeCoreProfile(guardianAcceptedState(), GUARDIAN)!;
    expect(core.identity).toBe(
      "Uncompromising quality engineer. A senior verifier who treats every finding as evidence.",
    );
    expect(core.voice).toBe("Precise, specific, numbered.");
    expect(core.principles).toEqual([
      "Verify before trusting",
      "Every claim carries its evidence",
    ]);
    expect(core.constraints).toEqual(["Never auto-resolve findings"]);
    expect(core.decisionPrinciples).toEqual(["When uncertain, verify once more"]);
  });

  it("drives BOTH risk dials from a moved slider, leaving deference alone", () => {
    const core = composeCoreProfile(guardianAcceptedState({ disposition: 0.8 }), GUARDIAN)!;
    expect(core.riskTolerance).toBe(0.8);
    expect(core.speedVsQuality).toBe(0.8);
    expect(core.deference).toBe(0.25);
  });

  it("treats a slider returned exactly to its seed as untouched", () => {
    // Moving away and back lands on the same float applyPreset seeded, so the
    // archetype's authored speedVsQuality must survive.
    const core = composeCoreProfile(guardianAcceptedState({ disposition: 0.15 }), GUARDIAN)!;
    expect(core.speedVsQuality).toBe(0.2);
  });

  it("overlays a chosen conflict style verbatim and keeps the base's when cleared", () => {
    const chosen = composeCoreProfile(
      guardianAcceptedState({ conflictStyle: "analyst" }),
      GUARDIAN,
    )!;
    expect(chosen.conflictStyle).toBe("analyst");
    // Cleared (toggled off) = no overlay → the authored style stands.
    const cleared = composeCoreProfile(
      guardianAcceptedState({ conflictStyle: null }),
      GUARDIAN,
    )!;
    expect(cleared.conflictStyle).toBe("challenger");
  });

  it("appends trait directives into principles in selection order, deduped", () => {
    const core = composeCoreProfile(
      guardianAcceptedState({ traits: ["terse", "evidence-first", "terse"] }),
      GUARDIAN,
    )!;
    expect(core.principles).toEqual([
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
    const core = composeCoreProfile(
      guardianAcceptedState({ traits: ["terse"] }),
      archetype,
    )!;
    expect(core.principles).toEqual([directive("terse")]);
  });
});

// -- Archetype-less composition ----------------------------------------------

describe("composeCoreProfile without an archetype", () => {
  const designCore: CoreProfile = {
    motivation: "LLM-authored motivation.",
    stance: "LLM-authored stance.",
    northStarCommitment: "LLM-authored commitment.",
    riskTolerance: 0.3,
    speedVsQuality: 0.7,
    conflictStyle: "pragmatist",
    deference: 0.6,
    identity: "LLM identity.",
    voice: undefined,
    principles: ["LLM principle"],
    constraints: ["LLM constraint"],
    decisionPrinciples: [],
  };

  it("overlays codex choices on the design core without erasing its prose", () => {
    const core = composeCoreProfile(
      defaultState({ conflictStyle: "challenger", traits: ["terse"] }),
      null,
      designCore,
    )!;
    expect(core.motivation).toBe("LLM-authored motivation.");
    expect(core.identity).toBe("LLM identity.");
    // Slider untouched → the design core's dials survive.
    expect(core.riskTolerance).toBe(0.3);
    expect(core.speedVsQuality).toBe(0.7);
    expect(core.deference).toBe(0.6);
    expect(core.conflictStyle).toBe("challenger");
    expect(core.principles).toEqual(["LLM principle", directive("terse")]);
    expect(core.constraints).toEqual(["LLM constraint"]);
  });

  it("lets a moved slider override the design core's dials", () => {
    const core = composeCoreProfile(
      defaultState({ disposition: 0.95 }),
      null,
      designCore,
    )!;
    expect(core.riskTolerance).toBe(0.95);
    expect(core.speedVsQuality).toBe(0.95);
  });

  it("falls back to a neutral base when no design core exists", () => {
    const core = composeCoreProfile(defaultState({ traits: ["terse"] }), null, null)!;
    expect(core.riskTolerance).toBe(0.5);
    expect(core.speedVsQuality).toBe(0.5);
    expect(core.conflictStyle).toBe("harmonizer");
    expect(core.principles).toEqual([directive("terse")]);
    expect(core.motivation).toBe("");
  });
});

// -- Wire shape --------------------------------------------------------------

describe("composed core wire shape", () => {
  it("serializes with the Rust serde contract's camelCase keys and omits empty optionals", () => {
    const core = composeCoreProfile(defaultState({ traits: ["terse"] }), null, null)!;
    const wire = JSON.parse(JSON.stringify(core)) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual([
      "conflictStyle",
      "constraints",
      "decisionPrinciples",
      "deference",
      "motivation",
      "northStarCommitment",
      "principles",
      "riskTolerance",
      "speedVsQuality",
      "stance",
    ]);
    // identity/voice were empty → undefined → absent on the wire, matching
    // `serializeCoreProfile`'s omit-empty-optionals discipline.
    expect("identity" in wire).toBe(false);
    expect("voice" in wire).toBe(false);
  });
});

// -- Boundary narrowing ------------------------------------------------------

describe("extractDesignCore / narrowCoreProfile", () => {
  it("pulls persona.core out of a v3-shaped agent_ir", () => {
    const core = extractDesignCore({
      persona: { core: { motivation: "m", riskTolerance: 0.1, decision_principles: ["d"] } },
    })!;
    expect(core.motivation).toBe("m");
    expect(core.riskTolerance).toBe(0.1);
    // snake_case decision_principles (v3 authoring) is accepted.
    expect(core.decisionPrinciples).toEqual(["d"]);
  });

  it("returns null for flat, missing, or malformed payloads", () => {
    expect(extractDesignCore({ system_prompt: "flat ir" })).toBeNull();
    expect(extractDesignCore(null)).toBeNull();
    expect(extractDesignCore("garbage")).toBeNull();
    expect(extractDesignCore({ persona: { core: [] } })).toBeNull();
  });

  it("clamps dials and defaults the conflict style when narrowing", () => {
    const core = narrowCoreProfile({ riskTolerance: 7, speedVsQuality: -1 })!;
    expect(core.riskTolerance).toBe(1);
    expect(core.speedVsQuality).toBe(0);
    expect(core.conflictStyle).toBe("harmonizer");
  });
});
