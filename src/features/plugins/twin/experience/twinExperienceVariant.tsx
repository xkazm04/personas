// TEMPORARY — /contest scaffold (2026-09-21, second round 2026-09-24). Four
// takes on creating and training a twin live side by side and one switch flips
// every entry point at once: "New twin" on Profiles and the Setup tab.
//
//   current — master before the contest: the md dialog + the in-tab Setup desk.
//   opus5   — a full-screen CARD TABLE: four suits, a dealt question, a fanned
//             hand, offers that turn over. Under `opus/`.
//   grok46  — a playing-card DECK in a capped overlay: double-bordered cards
//             with rank pips, a forge, a fan. Under `grok/`.
//   mirror  — one lit LANE: a question, three answer slats, one field, and
//             everything heavier behind a door off it. Under `mirror/`.
//
// The choice is in memory only — it resets to Mirror on reload, which is fine
// for a comparison that lives days.
//
// The backend is NOT switched: every variant runs on the same Rust (the setup
// turn carries the `samples` contract the tables need).
//
// Once a winner is picked: delete the losing folders, this file, the two
// wiring points in TwinPage/ProfilesAtelier, and the losers' i18n keys; move
// the winner up to experience/.
import { useId, useSyncExternalStore } from 'react';

import { lazyRetry } from '@/lib/lazyRetry';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { CreateTwinDialog } from '../sub_profiles/CreateTwinDialog';
import { TwinExperienceSelfHosted as GrokExperience } from './grok';
import { TwinExperienceHost as OpusHost, openTwinExperience } from './opus';
import { MirrorHost, openMirror } from './mirror';

/** Contestant ids — not model choices (hence not bare model names). */
export type TwinExperienceVariant = 'current' | 'opus5' | 'grok46' | 'mirror';

// Proper names of the contestants, not product copy — the scaffold is deleted
// with the losers, so these never reach the i18n catalogs.
const TABS: Array<{ id: TwinExperienceVariant; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'opus5', label: 'Table' },
  { id: 'grok46', label: 'Deck' },
  { id: 'mirror', label: 'Mirror' },
];

let variant: TwinExperienceVariant = 'mirror';
/** A pending "New twin" for the current/grok variants (the other two launch themselves). */
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
  if (variant === 'mirror') {
    openMirror({ mode: 'create' });
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
  if (!open || live === 'opus5' || live === 'mirror') return null;
  return live === 'grok46' ? <GrokExperience mode="create" onClose={stopCreating} /> : <CreateTwinDialog onClose={stopCreating} />;
}

/** The full-screen layers, one per variant that owns one. Mounted beside the tab router. */
export function VariantExperienceHost() {
  const live = useTwinExperienceVariant();
  if (live === 'opus5') return <OpusHost />;
  if (live === 'mirror') return <MirrorHost />;
  return null;
}

const CurrentSetupPage = lazyRetry(() => import('../setup/SetupPage'));
const OpusSetupPage = lazyRetry(() => import('./opus/ExperienceSetupPage'));
const GrokSetupPage = lazyRetry(() => import('./grok/GrokSetupPage'));
const MirrorSetupPage = lazyRetry(() => import('./mirror/MirrorSetupPage'));

/** The Setup tab, as each variant renders it. TwinPage's own Suspense (RouteChunkSkeleton) covers the chunk load. */
export function VariantSetupPage({ onOpenHub }: { onOpenHub: () => void }) {
  const live = useTwinExperienceVariant();
  return (
    <>
      {live === 'current' && <CurrentSetupPage onOpenHub={onOpenHub} />}
      {live === 'opus5' && <OpusSetupPage />}
      {live === 'grok46' && <GrokSetupPage onOpenHub={onOpenHub} />}
      {live === 'mirror' && <MirrorSetupPage />}
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
