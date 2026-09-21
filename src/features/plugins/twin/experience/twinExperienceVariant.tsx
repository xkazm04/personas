// TEMPORARY — /contest scaffold (2026-09-21). Three takes on creating and
// training a twin live side by side (current = master before the contest, the
// md dialog + in-tab Setup desk; opus = Claude Opus 5 xhigh under opus/; grok =
// Grok 4.6 high under grok/), and one switch flips both entry points at once:
// "New twin" on Profiles and the Setup tab. The choice is in memory only — it
// resets to Opus on reload, which is fine for a comparison that lives days.
//
// The backend is NOT switched: both variants run on Opus's Rust (its setup
// turn carries the new `samples` contract Opus's table needs). Grok's prompt
// rewrite stays on branch worktree-contest-twin-grok (24dd5f6c4) for reference.
//
// Once a winner is picked: delete the losing folder, this file, the two wiring
// points in TwinPage/ProfilesAtelier, and the loser's i18n keys; move the
// winner up to experience/.
import { useId, useSyncExternalStore } from 'react';

import { lazyRetry } from '@/lib/lazyRetry';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { CreateTwinDialog } from '../sub_profiles/CreateTwinDialog';
import { TwinExperienceSelfHosted as GrokExperience } from './grok';
import { openTwinExperience } from './opus';

/** Contestant ids — not model choices (hence not bare model names). */
export type TwinExperienceVariant = 'current' | 'opus5' | 'grok46';

// Proper names of the contestants, not product copy — the scaffold is deleted
// with the losers, so these never reach the i18n catalogs.
const TABS: Array<{ id: TwinExperienceVariant; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'opus5', label: 'Opus 5 · xhigh' },
  { id: 'grok46', label: 'Grok 4.6 · high' },
];

let variant: TwinExperienceVariant = 'opus5';
/** A pending "New twin" for the current/grok variants (opus has its own launcher). */
let creating = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

function setVariant(next: TwinExperienceVariant) {
  variant = next;
  creating = false;
  emit();
}

export function useTwinExperienceVariant(): TwinExperienceVariant {
  return useSyncExternalStore(subscribe, () => variant);
}

/**
 * "New twin", routed to whichever variant is live. The current/grok dialogs are
 * hosted by `VariantCreateHost` in TwinPage rather than by the roster, because
 * the roster swaps its whole tree when the first twin appears — a dialog owned
 * by that branch would be unmounted halfway through its own flow.
 */
export function startCreateTwin() {
  if (variant === 'opus5') {
    openTwinExperience({ mode: 'create' });
    return;
  }
  creating = true;
  emit();
}

function stopCreating() {
  creating = false;
  emit();
}

export function VariantCreateHost() {
  const live = useTwinExperienceVariant();
  const open = useSyncExternalStore(subscribe, () => creating);
  if (!open || live === 'opus5') return null;
  return live === 'grok46' ? <GrokExperience mode="create" onClose={stopCreating} /> : <CreateTwinDialog onClose={stopCreating} />;
}

const CurrentSetupPage = lazyRetry(() => import('../setup/SetupPage'));
const OpusSetupPage = lazyRetry(() => import('./opus/ExperienceSetupPage'));
const GrokSetupPage = lazyRetry(() => import('./grok/GrokSetupPage'));

/** The Setup tab, as each variant renders it. TwinPage's own Suspense (RouteChunkSkeleton) covers the chunk load. */
export function VariantSetupPage({ onOpenHub }: { onOpenHub: () => void }) {
  const live = useTwinExperienceVariant();
  return (
    <>
      {live === 'current' && <CurrentSetupPage onOpenHub={onOpenHub} />}
      {live === 'opus5' && <OpusSetupPage />}
      {live === 'grok46' && <GrokSetupPage onOpenHub={onOpenHub} />}
    </>
  );
}

/** The switch itself. It sits on the Twin page; each variant's overlay covers it while open. */
export function TwinExperienceVariantSwitch() {
  const live = useTwinExperienceVariant();
  const prefix = `twin-experience-variant-${useId()}`;
  return (
    <div className="flex flex-shrink-0 justify-end px-4 pt-2">
      <SegmentedTabs
        tabs={TABS}
        activeTab={live}
        onTabChange={setVariant}
        size="sm"
        fullWidth={false}
        idPrefix={prefix}
        ariaLabel="Twin experience variant"
      />
      <span {...segmentedTabPanelProps(prefix, live)} role="tabpanel" hidden />
    </div>
  );
}
