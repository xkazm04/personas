/**
 * DetailHeader — shared top band for every Inbox detail component.
 *
 * Renders:
 *   - Persona illustration at very low opacity as a warm background wash
 *     (same pattern as Console persona tiles; Phase 10 illustrations)
 *   - Top-to-transparent gradient to keep the title readable on any artwork
 *   - Kind badge (icon + colored pill)
 *   - Title (typo-hero) + persona attribution + relative timestamp
 *
 * Used by ApprovalDetail / MessageDetail / HealthDetail / OutputDetail so
 * the detail pane always has a consistent visual header regardless of kind.
 */
import type { ReactNode } from 'react';

import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';

import { useIllustration } from '../../../hooks/useIllustration';
import type { UnifiedInboxItem } from '../../../types';
import { formatRelativeTime } from '../../../utils/formatRelativeTime';

type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

export interface DetailHeaderProps {
  item: UnifiedInboxItem;
  /** Icon rendered inside the kind badge (e.g. <ShieldCheck className="w-3.5 h-3.5" />). */
  kindIcon: ReactNode;
  kindTone: Tone;
}

export function DetailHeader({ item, kindIcon, kindTone }: DetailHeaderProps) {
  const { t } = useTranslation();
  const s: Translations['simple_mode'] = t.simple_mode;

  const personas = useAgentStore((st) => st.personas);
  const persona = personas.find((p) => p.id === item.personaId) ?? null;
  const illustration = useIllustration(
    persona ?? {
      id: item.personaId,
      name: item.personaName,
      icon: item.personaIcon,
      description: null,
    },
  );

  return (
    <header className="relative overflow-hidden border-b border-foreground/10">
      <img
        src={illustration.url}
        aria-hidden
        alt=""
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: 0.15 }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background pointer-events-none" />

      <div className="relative px-6 py-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            className={[
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border typo-caption',
              `simple-accent-${kindTone}-border`,
              `simple-accent-${kindTone}-soft`,
              `simple-accent-${kindTone}-text`,
            ].join(' ')}
          >
            {kindIcon}
            <span className="truncate">{item.kind}</span>
          </span>
          <span className="typo-caption text-foreground/50 italic truncate">
            {item.personaName}
          </span>
          <span className="text-foreground/30">·</span>
          <span className="typo-caption text-foreground/55 shrink-0">
            {formatRelativeTime(s, item.createdAt)}
          </span>
        </div>

        <h1 className="typo-hero simple-display text-foreground">{item.title}</h1>
      </div>
    </header>
  );
}
