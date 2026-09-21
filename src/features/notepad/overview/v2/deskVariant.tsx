// TEMPORARY — /spark note-overview-cycle contest scaffold (2026-09-21). Three
// takes on the Notepad desk live side by side: the shipped baseline
// (overview/NoteOverview), v2/claude (Claude Opus 5 · xhigh) and v2/grok
// (Grok 4.6 via grok CLI). One in-memory switch picks which one the pad
// mounts; it resets to the baseline on reload, which is fine for a comparison
// that lives days. Once a winner is picked, the losing folder(s), this file
// and the losers' copy.ts are deleted, the winner's copy migrates to i18n, and
// the host imports the winner directly again.
import { useId, useSyncExternalStore } from 'react';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';

import { NoteOverview } from '../NoteOverview';
import type { NoteOverviewProps } from '../types';
import { NoteOverviewV2 as ClaudeDesk } from './claude/NoteOverviewV2';
import { NoteOverviewV2 as GrokDesk } from './grok/NoteOverviewV2';

/** Contestant ids — not model choices (hence not bare model names). */
export type DeskVariant = 'baseline' | 'opus5' | 'grok46';

// Proper names of the contestants, not product copy — the scaffold is deleted
// with the losers, so these never reach the i18n catalogs.
const TABS: Array<{ id: DeskVariant; label: string }> = [
  { id: 'baseline', label: 'Baseline' },
  { id: 'opus5', label: 'Opus 5 · xhigh' },
  { id: 'grok46', label: 'Grok 4.6' },
];

let current: DeskVariant = 'baseline';
const listeners = new Set<() => void>();

function setVariant(v: DeskVariant) {
  current = v;
  listeners.forEach((l) => l());
}

function useDeskVariant(): DeskVariant {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => current,
  );
}

/** The desk the pad mounts while the contest runs: the switch plus the variant it swaps. */
export function NoteOverviewContest(props: NoteOverviewProps & { loading: boolean }) {
  const variant = useDeskVariant();
  const prefix = `notepad-desk-variant-${useId()}`;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-shrink-0 justify-end px-8 pt-3" data-testid="notepad-desk-variant-switch">
        <SegmentedTabs
          tabs={TABS}
          activeTab={variant}
          onTabChange={setVariant}
          size="sm"
          fullWidth={false}
          idPrefix={prefix}
          ariaLabel="Desk variant"
        />
      </div>
      <div {...segmentedTabPanelProps(prefix, variant)} role="tabpanel" className="flex-1 min-h-0 flex flex-col">
        {variant === 'baseline' && <NoteOverview {...props} />}
        {variant === 'opus5' && <ClaudeDesk {...props} />}
        {variant === 'grok46' && <GrokDesk {...props} />}
      </div>
    </div>
  );
}
