/**
 * GlyphAnswerCard - every word on the card comes from the active locale.
 *
 * The dimension label used to come from an English-only copy of DIM_LABEL,
 * and the Send / Close affordances were literals, so the card spoke English
 * in all 13 other locales. A locale whose values differ from English proves
 * the card reads the bundle.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import en from "@/i18n/locales/en.json";

const cs = {
  ...en,
  common: { ...en.common, send: "Odeslat", close: "Zavrit" },
  agents: { ...en.agents, glyph_dim_label: { ...en.agents.glyph_dim_label, trigger: "Kdy" } },
};
vi.mock("@/i18n/useTranslation", () => ({
  getActiveTranslations: () => cs,
  useTranslation: () => ({ t: cs, tx: (s: string) => s }),
}));
vi.mock("@/features/vault/components/VaultConnectorPicker", () => ({
  VaultConnectorPicker: () => null,
}));

import { GlyphAnswerCard } from "../GlyphAnswerCard";

describe("GlyphAnswerCard copy", () => {
  it("renders the dimension label and actions from the locale", () => {
    render(
      <GlyphAnswerCard
        question={{ cellKey: "triggers", question: "When should it run?" } as never}
        onAnswer={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Kdy")).toBeTruthy();
    expect(screen.getByText("Odeslat")).toBeTruthy();
    expect(screen.getByLabelText("Zavrit")).toBeTruthy();
    expect(screen.queryByText("When")).toBeNull();
  });
});
