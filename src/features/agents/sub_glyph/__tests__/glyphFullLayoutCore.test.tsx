/** GlyphFullLayout — the Persona Core Codex on the Cinema compose surface.
 *
 *  GlyphFullLayout is what the `cinema` build layout renders while composing.
 *  It carried no Codex: no badge (the only door to the configurator) and no
 *  `onLaunchCoreSnapshot` call, so flipping the build-layout toggle silently
 *  dropped mentality/traits/model from the promote stamp. These cases pin both
 *  halves. sweep #41 / #354.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { CommandPanelProps } from "../commandPanel/types";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";

// The composer panel itself is exercised by its own tests; here it is a probe
// that records the props the layout hands it, which is where both contracts
// under test live (the codex snapshot at launch, and the restored picks). It
// keeps the real panel's launch affordance so the launch path is still driven
// through a click rather than by calling the prop directly.
let lastCommandPanelProps: CommandPanelProps | null = null;
vi.mock("../commandPanel", () => ({
  CommandPanel: (props: CommandPanelProps) => {
    lastCommandPanelProps = props;
    return (
      <div data-testid="stub-command-panel">
        <button type="button" data-testid="agent-launch-btn" onClick={props.onLaunch}>
          launch
        </button>
      </div>
    );
  },
}));

function quickConfig(over: Partial<QuickConfigState> = {}): QuickConfigState {
  return {
    frequency: "daily",
    days: ["mon"],
    monthDay: 1,
    time: "07:30",
    selectedConnectors: ["slack"],
    connectorTables: {},
    selectedEvents: [],
    notificationChannels: [],
    ...over,
  };
}

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

// --------------------------------------------------------------------------
// sweep #353 — the composer overlay unmounts on dismiss, and used to take four
// modal pickers' worth of structured picks with it.
// --------------------------------------------------------------------------

describe("GlyphFullLayout — composer picks survive a dismiss", () => {
  beforeEach(() => {
    useAgentStore.setState({ buildSessionId: null, buildDraft: null });
    lastCommandPanelProps = null;
  });

  it("hands the previous picks back when the overlay is reopened", async () => {
    render(<GlyphFullLayout {...baseProps()} />);
    await openComposer();

    const first = lastCommandPanelProps;
    expect(first).not.toBeNull();
    // Nothing to restore on the very first open.
    expect(first!.initialQuickConfig).toBeUndefined();

    // The composer emits its structured snapshot upward as the user picks.
    act(() => {
      first!.onQuickConfigChange?.(quickConfig());
    });

    // Esc dismisses the overlay: the panel unmounts and its state is gone.
    fireEvent.keyDown(window, { key: "Escape" });
    await openComposer();

    expect(lastCommandPanelProps!.initialQuickConfig).toMatchObject({
      frequency: "daily",
      time: "07:30",
      selectedConnectors: ["slack"],
    });
  });

  it("still forwards the picks to the parent", async () => {
    const onQuickConfigChange = vi.fn();
    render(<GlyphFullLayout {...baseProps({ onQuickConfigChange })} />);
    await openComposer();
    act(() => {
      lastCommandPanelProps!.onQuickConfigChange?.(quickConfig());
    });
    expect(onQuickConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: "daily" }),
    );
  });

  it("does not carry one build's schedule into the next session's composer", async () => {
    const view = render(<GlyphFullLayout {...baseProps()} />);
    await openComposer();
    act(() => {
      lastCommandPanelProps!.onQuickConfigChange?.(quickConfig());
    });
    fireEvent.keyDown(window, { key: "Escape" });

    // A new build session starts: the surface resets, and so must the picks.
    act(() => {
      useAgentStore.setState({ buildSessionId: "session-2" });
    });
    act(() => {
      useAgentStore.setState({ buildSessionId: null });
    });
    view.rerender(<GlyphFullLayout {...baseProps()} />);
    await openComposer();
    expect(lastCommandPanelProps!.initialQuickConfig).toBeUndefined();
  });
});
