/** GlyphFullLayout — the Persona Core Codex on the Cinema compose surface.
 *
 *  GlyphFullLayout is what the `cinema` build layout renders while composing.
 *  It carried no Codex: no badge (the only door to the configurator) and no
 *  `onLaunchCoreSnapshot` call, so flipping the build-layout toggle silently
 *  dropped mentality/traits/model from the promote stamp. These cases pin both
 *  halves. sweep #41 / #354.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GlyphFullLayout } from "../GlyphFullLayout";
import type { GlyphFullLayoutProps } from "../glyphLayoutTypes";
import { useAgentStore } from "@/stores/agentStore";

function baseProps(o: Partial<GlyphFullLayoutProps> = {}): GlyphFullLayoutProps {
  return {
    intentText: "",
    onIntentChange: vi.fn(),
    onLaunch: vi.fn(),
    launchDisabled: false,
    isBuilding: false,
    buildPhase: null,
    completeness: 0,
    cellStates: {},
    pendingQuestions: null,
    onAnswer: vi.fn(),
    agentName: "Draft agent",
    onAgentNameChange: vi.fn(),
    hasDesignResult: false,
    glyphRows: [],
    onStartTest: vi.fn(),
    onPromote: vi.fn(),
    onViewAgent: vi.fn(),
    buildError: null,
    ...o,
  };
}

/** Open the click-to-summon intent composer (the compose chrome the Codex
 *  lives in). The affordance is the centre of the sigil. */
async function openComposer(): Promise<void> {
  const summon = await screen.findByTestId("glyph-compose-summon");
  fireEvent.click(summon);
}

describe("GlyphFullLayout — Persona Core Codex", () => {
  beforeEach(() => {
    useAgentStore.setState({ buildSessionId: null, buildDraft: null });
  });

  it("mounts the Codex badge on the compose surface", async () => {
    render(<GlyphFullLayout {...baseProps()} />);
    await openComposer();
    await waitFor(() => {
      expect(screen.getByTestId("persona-core-badge")).toBeInTheDocument();
    });
  });

  it("sends the codex snapshot up when the compose surface launches", async () => {
    const onLaunch = vi.fn();
    const onLaunchCoreSnapshot = vi.fn();
    render(<GlyphFullLayout {...baseProps({ onLaunch, onLaunchCoreSnapshot })} />);
    await openComposer();

    const launch = await screen.findByTestId("agent-launch-btn");
    fireEvent.click(launch);

    expect(onLaunchCoreSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = onLaunchCoreSnapshot.mock.calls[0]![0] as {
      state: { model: string; traits: string[] };
      archetype: unknown;
    };
    expect(snapshot.state).toMatchObject({ traits: [] });
    expect(typeof snapshot.state.model).toBe("string");
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });
});
