import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en.json";
import cs from "@/i18n/locales/cs.json";
import { CONFLICT_STYLES, EFFORT_TIERS, MODEL_TIERS, TRAIT_AXES, TRAIT_CATALOG } from "../catalog";

const keysOf = () => [
  ...TRAIT_AXES.map((a) => a.labelKey),
  ...TRAIT_CATALOG.flatMap((t) => [t.labelKey, t.blurbKey]),
  ...CONFLICT_STYLES.flatMap((c) => [c.labelKey, c.blurbKey]),
  ...MODEL_TIERS.map((m) => m.blurbKey),
  ...EFFORT_TIERS.map((e) => e.blurbKey),
];

describe("persona core catalog copy", () => {
  it("carries a display key (not an English literal) for every label and blurb", () => {
    const keys = keysOf();
    expect(keys.length).toBe(5 + 40 + 8 + 3 + 4);
    expect(keys.filter((k) => !k || !k.startsWith("core_"))).toEqual([]);
  });

  it("resolves every key to text in English and in Czech, and Czech differs", () => {
    const enAgents = en.agents as Record<string, unknown>;
    const csAgents = cs.agents as Record<string, unknown>;
    const missing = keysOf().filter((k) => typeof enAgents[k] !== "string" || typeof csAgents[k] !== "string");
    expect(missing).toEqual([]);
    const same = keysOf().filter((k) => csAgents[k] === enAgents[k]);
    expect(same).toEqual([]);
  });
});
