import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { NOTE_CAP } from '../notepadStore';
import NoteOverviewIndexCards from './NoteOverviewIndexCards';
import NoteOverviewLifecycle from './NoteOverviewLifecycle';
import NoteOverviewProjectDesk from './NoteOverviewProjectDesk';
import { OverviewGhost } from './parts/NoteCardBits';
import { OVERVIEW_COPY, fill } from './prototypeCopy';
import type { NoteOverviewProps } from './types';

// TODO(prototype, 2026-09-14): consolidate the notepad overview switcher —
// keep the winner, delete the other two variants, this map and prototypeCopy.
const VARIANTS = {
  cards: { label: OVERVIEW_COPY.variant_cards, Body: NoteOverviewIndexCards },
  lifecycle: { label: OVERVIEW_COPY.variant_lifecycle, Body: NoteOverviewLifecycle },
  desk: { label: OVERVIEW_COPY.variant_desk, Body: NoteOverviewProjectDesk },
} as const;
type OverviewVariant = keyof typeof VARIANTS;

/**
 * Layer 1 of the pad: every open note at once. A card opens layer 2 — the
 * full editor (`NoteBody`, with the tab strip and dispatch bar around it).
 */
export function NoteOverview({ loading, ...props }: NoteOverviewProps & { loading: boolean }) {
  const { t } = useTranslation();
  const [variant, setVariant] = useState<OverviewVariant>('cards');
  const { Body } = VARIANTS[variant];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="notepad-overview">
      <div className="px-8 py-6 flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="typo-heading-lg text-foreground">{t.notepad.tabs_label}</h2>
            <span className="typo-caption text-foreground/60">
              {fill(OVERVIEW_COPY.count, { count: props.notes.length, cap: NOTE_CAP })}
            </span>
          </div>
          <SegmentedTabs
            tabs={(Object.keys(VARIANTS) as OverviewVariant[]).map((id) => ({ id, label: VARIANTS[id].label }))}
            activeTab={variant}
            onTabChange={setVariant}
            size="sm"
            fullWidth={false}
            ariaLabel={t.notepad.variant_label}
            layoutId="notepad-overview-variant"
          />
        </div>

        {loading ? <OverviewGhost /> : <Body {...props} />}
      </div>
    </div>
  );
}
