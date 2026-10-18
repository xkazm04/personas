/**
 * GlyphCapabilityPreview - the count header.
 *
 * `excludedCapabilityIds` is a list of ids the operator removed, and nothing
 * prunes it when a refine replaces the capability set. An id that is no
 * longer in `capabilityOrder` names nothing on screen, so it must not lower
 * the "N capabilities" count or show up as "(1 removed)".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import en from "@/i18n/locales/en.json";
vi.mock("@/i18n/useTranslation", () => ({
  getActiveTranslations: () => en,
  useTranslation: () => ({
    t: en,
    tx: (s: string, v: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? "")),
  }),
}));

const state: { activeBuildSessionId: string | null; buildSessions: Record<string, unknown>; toggleCapabilityExcluded: () => void } = {
  activeBuildSessionId: "s1",
  buildSessions: {},
  toggleCapabilityExcluded: () => {},
};
vi.mock("@/stores/agentStore", () => ({
  useAgentStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

import { GlyphCapabilityPreview } from "../GlyphCapabilityPreview";

function session(order: string[], excluded: string[]) {
  const capabilities = Object.fromEntries(order.map((id) => [id, { title: `Cap ${id}` }]));
  state.buildSessions = { s1: { capabilities, capabilityOrder: order, excludedCapabilityIds: excluded, behaviorCore: null } };
}

beforeEach(() => {
  state.buildSessions = {};
});

describe("GlyphCapabilityPreview count", () => {
  it("counts a removed capability that is still on screen", () => {
    session(["a", "b", "c"], ["b"]);
    render(<GlyphCapabilityPreview />);
    expect(screen.getByText(/2 capabilities/)).toBeTruthy();
  });

  it("ignores an excluded id that no longer names a capability", () => {
    // A refine replaced capability "gone"; its exclusion outlived it.
    session(["a", "b"], ["gone"]);
    render(<GlyphCapabilityPreview />);
    expect(screen.getByText(/2 capabilities/)).toBeTruthy();
    expect(screen.queryByText(/removed\)/)).toBeNull();
  });
});
