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
  // `t` is the full Translations bundle — passed straight through to
  // formatRelativeTime which reads plural-aware keys from
  // `t.simple_mode.inbox.relative_*` (Phase 15-01).
  const { t } = useTranslation();

  const personas = useAgentStore((st) => st.personas);
  const persona = personas.find((p) => p.id === item.personaId) ?? null;
  const illustration = useIllustration(
    persona ?? {
      id: item.personaId,
      name: item.personaName,
      icon: item.personaIcon,
      description: null,
      design_context: null,
      // Phase 17: synthesized personas (constructed when the real persona row
      // is missing) have no template metadata. Null falls through to tier-4.
      template_category: null,
    },
  );

  return (
    <header className="relative overflow-hidden border-b border-foreground/10">
      <img
        src={illustration.url}
        aria-hidden
        alt=""
        className="simple-illustration simple-illustration-header absolute inset-0 w-full h-full object-cover pointer-events-none"
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
            {formatRelativeTime(item.createdAt, t)}
          </span>
        </div>

        <h1 className="typo-hero simple-display text-foreground">{item.title}</h1>
      </div>
    </header>
  );
}
