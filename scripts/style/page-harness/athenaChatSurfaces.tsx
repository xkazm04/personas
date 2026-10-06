/**
 * The Athena chat overlay (`AthenaChatPanel`), OPEN, over a real route surface,
 * on the synthetic tapes in `athenaChatTapes.mjs`.
 *
 * Module ids are scenarios: `athena/chat/{idle,streaming,waiting,decision,empty}`.
 * Everything else is a URL param, so one tape serves every variant:
 *   variant=fusion|current|filament   which chat the switcher shows (default: the store's, fusion)
 *   bg=executions|none                            the route behind the chat (default: Overview > Executions)
 * `shoot.mjs --query "variant=fusion&bg=none"` passes them; `--reduced-motion`
 * forces both reduced-motion signals (see main.tsx).
 *
 * In the app the chat is a global overlay mounted beside `PersonasPage`
 * (App.tsx `<AthenaGate>`), not inside a route. Its layers are `position:
 * fixed` from `top-[112px]` (the 48px `.titlebar` the frame draws, plus the
 * route's header band), so rendering it after the route inside `#main-content`
 * puts it exactly where the app does.
 *
 * `prepare` does what the app has done by the time a user opens the chat:
 *  - FleetBootstrap filled `fleetSessions`, Dev Tools loaded `projects`;
 *  - the MCP bridge collected pending session requests, the decision queue
 *    set `pendingDecision`, the assignment bridge its refs, and the
 *    operative-memory bridge the digest;
 *  - `companion_init` resolved (`initialized`), so the chat's own hydration
 *    fetches the transcript, approvals, nudges and durable cards from the tape;
 *  - for `streaming`, a turn is in flight (the bridge's `forceCompanionStreaming`).
 */
import { useDecisionStyle, type DecisionStyle } from '@/features/companions/athena/chat/next/frame/variants/fusion/decision/style';
import type { ComponentType, ReactNode } from 'react';
import type { HarnessModule } from './registry';
import { ACTIVITY_MODULES } from './activitySurfaces';

interface Seed {
  projects: unknown[];
  fleetSessions: unknown[];
  mcpRequests: unknown[];
  decision: null | {
    id: string;
    prompt: string;
    options: Array<{ label: string; hint?: string; danger?: boolean }>;
    recommendation?: string;
    detail?: string;
    source: string;
    sourceRef?: string;
  };
  assignments: unknown[];
  digest: string;
  conversations: unknown[];
  conversationId: string;
  streaming: null | { text: string; phase: { kind: 'thinking' | 'tool_use' | 'reviewing'; toolName?: string }; beat: string };
  layer: null | { kind: 'work'; focus: string | null; project: string | null };
}

const VARIANTS = ['fusion', 'current', 'filament'] as const;
const BACKGROUND = ACTIVITY_MODULES['overview/sub_activity']!;

const params = new URLSearchParams(window.location.search);
const bg = params.get('bg') ?? 'executions';

/** The synthetic tape's seed (injected, or fetched by `?tape=`); null on a recorded tape. */
function readSeed(): Seed | null {
  const calls = window.__PAGE_HARNESS_TAPE__?.calls ?? [];
  return (calls.find((c) => c.cmd === '__harness_seed')?.response as Seed | undefined) ?? null;
}

/** A recorded tape has no seed: load what the app's bootstraps would have, from the tape's IPC. */
async function prepareFromRecording(): Promise<void> {
  const [{ useSystemStore }, { listSessions }] = await Promise.all([import('@/stores/systemStore'), import('@/api/fleet/fleet')]);
  try {
    useSystemStore.setState({ fleetSessions: (await listSessions())?.sessions ?? [] });
    await useSystemStore.getState().fetchProjects();
  } catch (err) {
    console.warn('[page-harness] athena/chat: loading the fleet from the recording failed', err);
  }
}

async function prepareChat(): Promise<void> {
  if (bg !== 'none') await BACKGROUND.prepare?.();
  const seed = readSeed();
  const [{ useSystemStore }, { useAthenaStore }, { useMcpRequestStore }, { useOperativeMemoryStore }, { useChatVariantStore }, { setInitialLayerView }] =
    await Promise.all([
      import('@/stores/systemStore'),
      import('@/features/companions/athena/athenaStore'),
      import('@/features/companions/athena/mcp/mcpRequestStore'),
      import('@/features/companions/athena/orchestration/operativeMemoryStore'),
      import('@/features/companions/athena/chat/next/ChatVariantTabs'),
      import('@/features/companions/athena/chat/next/useLayer'),
    ]);

  // Round 6: which decision surface Fusion's stage renders (now | v1 | v2 | v3).
  const decision = params.get('decision');
  if (decision) useDecisionStyle.getState().set(decision as DecisionStyle);
  const variant = params.get('variant');
  if (variant) {
    if (!(VARIANTS as readonly string[]).includes(variant)) throw new Error(`unknown variant "${variant}" (have: ${VARIANTS.join(', ')})`);
    useChatVariantStore.getState().set(variant as (typeof VARIANTS)[number]);
  }
  const athena = useAthenaStore.getState();
  if (!seed) {
    await prepareFromRecording();
    athena.setInitialized(true);
    athena.setState('open');
    return;
  }
  if (seed.layer) setInitialLayerView(seed.layer);

  useSystemStore.setState({
    fleetSessions: seed.fleetSessions as never,
    projects: seed.projects as never,
    athenaPanelCompact: false,
    // Off: with autonomy on, a fleet-plan card auto-approves on mount
    // (AthenaFleetPlanCard) and nothing would be left waiting.
    athenaAutonomousMode: false,
    fleetGridOpen: false,
  });
  useMcpRequestStore.setState({ pendingRequests: seed.mcpRequests as never });
  useOperativeMemoryStore.getState().setDigest(seed.digest);

  athena.setConversations(seed.conversations as never);
  athena.setActiveConversationId(seed.conversationId);
  for (const a of seed.assignments) athena.upsertAthenaAssignment(a as never);
  if (seed.decision) {
    const d = seed.decision;
    athena.setPendingDecision({
      ...d,
      source: d.source as never,
      // Picking an option resolves nothing in a shot; the chip still renders and presses.
      options: d.options.map((o, i) => ({ key: `opt-${i}`, label: o.label, hint: o.hint, danger: o.danger, run: () => {} })),
    });
  }
  if (seed.streaming) {
    athena.setStreaming(true);
    athena.resetStreamingText();
    athena.appendStreamingText(seed.streaming.text);
    athena.setStreamingPhase(seed.streaming.phase);
    athena.setStreamingBeat(seed.streaming.beat);
  }
  // Last: `initialized` is what starts the chat's hydration effects, so every
  // store they merge into is already in its app state.
  athena.setInitialized(true);
  athena.setState('open');
}

const load = async (): Promise<{ default: ComponentType }> => {
  const [{ default: Chat }, background] = await Promise.all([
    import('@/features/companions/athena/chat/AthenaChatPanel'),
    bg === 'none' ? Promise.resolve(null) : BACKGROUND.load(),
  ]);
  const Route = background?.default ?? null;
  return {
    default: function AthenaChatHost() {
      return (
        <>
          {Route && <Route />}
          <Chat />
        </>
      );
    },
  };
};

/**
 * App.tsx's own providers above every overlay: the keyboard ladder (Alt+W, Esc
 * and the variants' keys answer through it), the modal stack, and the live
 * region the decision card announces into. Then the route's own.
 */
const providers = async (): Promise<(children: ReactNode) => ReactNode> => {
  const [{ AppKeyboardProvider }, { ModalStackProvider }, { AriaLiveProvider }, route] = await Promise.all([
    import('@/lib/keyboard/AppKeyboardProvider'),
    import('@/lib/ui/ModalStackContext'),
    import('@/features/shared/components/feedback/AriaLiveProvider'),
    bg !== 'none' && BACKGROUND.providers ? BACKGROUND.providers() : Promise.resolve((children: ReactNode) => children),
  ]);
  return (children) => (
    <AppKeyboardProvider>
      <ModalStackProvider>
        <AriaLiveProvider>{route(children)}</AriaLiveProvider>
      </ModalStackProvider>
    </AppKeyboardProvider>
  );
};

const entry: HarnessModule = { load, providers, prepare: prepareChat };

export const ATHENA_CHAT_MODULES: Record<string, HarnessModule> = Object.fromEntries(
  ['idle', 'streaming', 'waiting', 'decision', 'empty'].map((scenario) => [`athena/chat/${scenario}`, entry]),
);
