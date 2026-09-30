/**
 * Kit batch home-2: Home > Cockpit (`home/sub_cockpit`) and the two other places its widget
 * registry renders, on the synthetic tapes in `homeCockpitTapes.mjs`.
 *
 *   home/cockpit                      returning operator, never composed: the deterministic
 *                                     default cockpit (40 personas) + the resume banner
 *   home/cockpit/composed-a..d        Athena-composed specs that together put all 30 registry
 *                                     kinds on screen (a ops, b explanation, c design arc,
 *                                     d onboarding and QA)
 *   home/cockpit/contextual-explain   the explain_in_cockpit overlay, a live orb decision
 *   home/cockpit/contextual-briefing  the Morning Director overlay, widgets with actions
 *   home/cockpit/contextual-message   the Overview > Messages "Play in chat" overlay
 *   home/cockpit/states               fresh profile: Get Started band + empty state
 *   home/cockpit/states/error         the cockpit fetch rejects
 *   home/cockpit/states/loading       the cockpit fetch is held, so the ghost grid shows
 *   athena/inline-cards               Athena's chat-card stack (`AthenaChatCards`, the real
 *                                     parent of InlineChatCard) in a column at the expanded
 *                                     panel width; the panel shell, transcript and engine are
 *                                     NOT mounted (they need a live companion session)
 *   curator/evidence-well[/rivalry]   one council member reading (`MemberReading`, the real
 *                                     parent of EvidenceWell) in RoundTable's right column;
 *                                     the round-table SVG column is an empty stand-in
 *
 * CockpitPanel is mounted directly in HomePage's keep-alive pane rather than through
 * HomePage, because HomePage's session-open briefing hook would overwrite the overlay a
 * view seeds. Store state outside IPC (inbox rows, chat cards, a council seat, the overlay,
 * the orb decision) arrives as the tape's `__harness_seed` pseudo-call, read in `prepare`.
 */
import type { ComponentType } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

type Seed = Record<string, unknown>;

/** The tape's seed block; empty when the tape was passed by URL instead of injected. */
function readSeed(): Seed {
  const calls = window.__PAGE_HARNESS_TAPE__?.calls ?? [];
  // The seed shape is authored next to the view in homeCockpitTapes.mjs; nothing else writes it.
  return (calls.find((c) => c.cmd === '__harness_seed')?.response as Seed | undefined) ?? {};
}

/** Holds one command's promise open, so a surface stays in its loading state for the shot. */
function holdCommand(cmd: string): void {
  // The harness's mocked internals; the running app never loads this file.
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (...a: unknown[]) => unknown } }).__TAURI_INTERNALS__;
  if (!internals) return;
  const original = internals.invoke.bind(internals);
  try {
    internals.invoke = (c: unknown, ...rest: unknown[]) => (c === cmd ? new Promise(() => {}) : original(c, ...rest));
  } catch (err) {
    console.warn('[page-harness] could not hold', cmd, err);
  }
}

async function prepareCockpit(opts: { fresh?: boolean; hold?: boolean } = {}): Promise<void> {
  const seed = readSeed();
  if (opts.hold) holdCommand('companion_get_cockpit');
  useSystemStore.setState({
    sidebarSection: 'home',
    homeTab: 'cockpit',
    onboardingCompleted: !opts.fresh,
    // The seed's overlay is authored against ContextualCockpit in homeCockpitTapes.mjs.
    contextualCockpit: (seed.contextual as never) ?? null,
  });
  const [{ useOverviewStore }, { useAgentStore }, { useAthenaStore }] = await Promise.all([
    import('@/stores/overviewStore'),
    import('@/stores/agentStore'),
    import('@/features/companions/athena/athenaStore'),
  ]);
  const inbox = seed.inbox as Record<string, unknown[]> | undefined;
  // Inbox rows follow ManualReviewItem / PersonaReport / PersonaHealingIssue (see the tape).
  if (inbox) useOverviewStore.setState(inbox as never);
  if (seed.runsSample) useOverviewStore.setState({ homeRunsSample: seed.runsSample as never });
  const decision = seed.pendingDecision as { options: Array<Record<string, unknown>> } | undefined;
  if (decision) {
    useAthenaStore.setState({
      // PendingDecision minus its option callbacks, which JSON cannot carry.
      pendingDecision: { ...decision, options: decision.options.map((o) => ({ ...o, run: () => {} })) } as never,
    });
  }
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
}

async function loadCockpit(): Promise<{ default: ComponentType }> {
  const { default: Panel } = await import('@/features/home/sub_cockpit/CockpitPanel');
  return {
    default: function CockpitHost() {
      // HomePage's outer column + the keep-alive pane of an active tab (PANE_CLASS, minus its entrance).
      return (
        <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
            <Panel />
          </div>
        </div>
      );
    },
  };
}

async function prepareChat(): Promise<void> {
  const seed = readSeed();
  const [{ useAthenaStore }, { useOverviewStore }, { useAgentStore }] = await Promise.all([
    import('@/features/companions/athena/athenaStore'),
    import('@/stores/overviewStore'),
    import('@/stores/agentStore'),
  ]);
  // ChatCard rows as the dispatcher emits them (kind, title, config).
  useAthenaStore.setState({ chatCards: (seed.chatCards as never) ?? [] });
  if (seed.inbox) useOverviewStore.setState(seed.inbox as never);
  try {
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
}

async function loadChatCards(): Promise<{ default: ComponentType }> {
  const { AthenaChatCards } = await import('@/features/companions/athena/chat/AthenaChatProposals');
  return {
    default: function AthenaCardsHost() {
      // AthenaChatPanel's shell (not fixed here) at PANEL_WIDTH_PX, and AthenaChatBody's
      // expanded scroll region around the real card stack.
      return (
        <div className="flex-1 min-h-0 flex p-4">
          <div className="w-[912px] max-w-full flex flex-col rounded-card bg-background/95 border border-foreground/10 shadow-elevation-4 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
              <AthenaChatCards />
            </div>
          </div>
        </div>
      );
    },
  };
}

async function loadMemberReading(): Promise<{ default: ComponentType }> {
  const { MemberReading } = await import('@/features/companions/curator/council/table/MemberReading');
  return {
    default: function CouncilHost() {
      const seed = readSeed();
      // Seat as runModel draws it; MemberReading reads only `run.id` off the run detail.
      const seat = seed.seat as never;
      const detail = { run: { id: String(seed.runId ?? '') } } as never;
      return (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,40%)_1fr]">
          <div className="hidden lg:block border-r border-border" data-harness="round-table-stand-in" />
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-8 pb-11 pt-5">
            <MemberReading seat={seat} detail={detail} weakest={null} />
          </div>
        </div>
      );
    },
  };
}

const cockpit = (opts?: { fresh?: boolean; hold?: boolean }): HarnessModule => ({ load: loadCockpit, prepare: () => prepareCockpit(opts) });

export const HOME_COCKPIT_MODULES: Record<string, HarnessModule> = {
  'home/cockpit': cockpit(),
  'home/cockpit/composed-a': cockpit(),
  'home/cockpit/composed-b': cockpit(),
  'home/cockpit/composed-c': cockpit(),
  'home/cockpit/composed-d': cockpit(),
  'home/cockpit/contextual-explain': cockpit(),
  'home/cockpit/contextual-briefing': cockpit(),
  'home/cockpit/contextual-message': cockpit(),
  'home/cockpit/states': cockpit({ fresh: true }),
  'home/cockpit/states/error': cockpit(),
  'home/cockpit/states/loading': cockpit({ hold: true }),
  'athena/inline-cards': { load: loadChatCards, prepare: prepareChat },
  'curator/evidence-well': { load: loadMemberReading },
  'curator/evidence-well/rivalry': { load: loadMemberReading },
};
