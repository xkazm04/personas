/**
 * SetupFieldsSection — one checklist slot as a band of the Fields page.
 *
 * The header row is the same three facts the readiness strip carries — the
 * slot's glyph, its name, and its status as COLOUR AND SHAPE plus the measured
 * `have/target` fact — so a strip segment and the section it scrolls to read as
 * the same object. `twinStatus` owns both halves of the status, and this file
 * reaches no further than the role it hands back.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Cable } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { TWIN_SLOTS, twinStatusEntry } from '../../shared/twinStatus';
import { StatusGlyph } from '../SetupReadinessRow';
import type { SetupChecklistItem, SetupFocus } from '../setupContract';

/**
 * The glyph per focus. Three of the four ARE profile slots and take the slot
 * table's icon, so a slot that is re-illustrated moves here in one edit.
 * `channels` is the one focus with no slot (see `twinStatus`'s FOCUS_TO_SLOT),
 * so it carries its own.
 */
const FOCUS_ICON: Record<SetupFocus, LucideIcon> = {
  identity: TWIN_SLOTS.identity.Icon,
  tone: TWIN_SLOTS.tone.Icon,
  channels: Cable,
  memories: TWIN_SLOTS.memories.Icon,
};

/** The scroll target a readiness-strip click in Fields mode jumps to. */
export function sectionDomId(slot: SetupFocus): string {
  return `setup-fields-section-${slot}`;
}

interface SetupFieldsSectionProps {
  item: SetupChecklistItem;
  /** Briefly marked because the strip or the buffer just pointed here. */
  spotlit: boolean;
  children: ReactNode;
}

export function SetupFieldsSection({ item, spotlit, children }: SetupFieldsSectionProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const entry = twinStatusEntry(item.status);
  const Icon = FOCUS_ICON[item.id];

  return (
    <section
      id={sectionDomId(item.id)}
      data-testid={`setup-fields-section-${item.id}`}
      aria-labelledby={`${sectionDomId(item.id)}-title`}
      className={[
        'rounded-card border bg-card/40 transition-shadow duration-500',
        spotlit ? 'border-primary/45 shadow-elevation-2' : 'border-primary/12',
      ].join(' ')}
    >
      <header className="flex items-center gap-2.5 px-4 md:px-5 py-3 border-b border-primary/10">
        <span
          aria-hidden
          className="w-7 h-7 flex-shrink-0 rounded-interactive bg-primary/10 border border-primary/20 flex items-center justify-center"
        >
          <Icon className="w-4 h-4 text-primary" />
        </span>
        <h2 id={`${sectionDomId(item.id)}-title`} className="typo-section-title truncate">
          {ts.checklist[item.labelKey]}
        </h2>
        <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <StatusGlyph status={item.status} />
          <span className={`typo-caption ${entry.text}`}>{t.twin.status[entry.labelKey]}</span>
          <span className={`typo-caption tabular-nums ${entry.text}`}>{item.detail}</span>
        </span>
      </header>
      <div className="px-4 md:px-5 py-4">{children}</div>
    </section>
  );
}

export default SetupFieldsSection;
