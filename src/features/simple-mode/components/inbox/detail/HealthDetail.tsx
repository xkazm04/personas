/**
 * HealthDetail — detail pane for `kind: 'health'` items.
 *
 * Shows:
 *   - DetailHeader with severity-scaled kind tone (rose when critical, gold otherwise).
 *   - Severity badge under the header (explicit label since the kind badge
 *     just says "health").
 *   - Body (raw issue description).
 *   - "Try this" card with `suggestedFix` when present — emerald accent so
 *     it reads as a positive next-step rather than another warning.
 *
 * The primary action (Resolve) is owned by the variant's ActionZone via
 * `useInboxActions` → `resolveHealingIssue(item.source, item.personaId)`.
 */
import { AlertCircle, Heart, Lightbulb } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { UnifiedInboxItem } from '../../../types';
import { DetailHeader } from './DetailHeader';

export interface HealthDetailProps {
  item: Extract<UnifiedInboxItem, { kind: 'health' }>;
}

export function HealthDetail({ item }: HealthDetailProps) {
  const { t } = useTranslation();
  const inb = t.simple_mode.inbox;
  const tone = item.severity === 'critical' ? 'rose' : 'gold';

  return (
    <div className="flex flex-col min-h-0 overflow-auto">
      <DetailHeader
        item={item}
        kindIcon={<Heart className="w-3.5 h-3.5" />}
        kindTone={tone}
      />

      <div className="px-6 pb-6 flex flex-col gap-4">
        {/* Severity badge */}
        <div>
          <span
            className={[
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption',
              `simple-accent-${tone}-border`,
              `simple-accent-${tone}-soft`,
              `simple-accent-${tone}-text`,
            ].join(' ')}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="truncate">{item.severity}</span>
          </span>
        </div>

        {/* Issue body */}
        <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] px-5 py-4">
          <p className="typo-body-lg text-foreground whitespace-pre-wrap">{item.body}</p>
        </div>

        {/* Suggested fix */}
        {item.data.suggestedFix ? (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <Lightbulb className="w-3.5 h-3.5 simple-accent-emerald-text" />
              <span className="typo-label uppercase tracking-wider simple-accent-emerald-text">
                {inb.try_this_label}
              </span>
            </div>
            <div className="rounded-2xl border simple-accent-emerald-border simple-accent-emerald-soft px-4 py-3">
              <p className="typo-body text-foreground whitespace-pre-wrap">
                {item.data.suggestedFix}
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
