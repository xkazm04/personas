import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';
import { listAttentionLedger } from '@/api/agents/responsibilities';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { silentCatch } from '@/lib/silentCatch';
import { attentionLedgerCache } from './lifeCache';

const VERDICT_VARIANT: Record<string, StatusVariant> = {
  started: 'processing',
  acted: 'success',
  noop: 'neutral',
  refused: 'warning',
  failed: 'error',
};

/**
 * Read-only strip of recent attention/consolidation passes — the honest
 * record of what the loop did (or refused to do) and why.
 */
export function AttentionLedgerStrip({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [entries, setEntries] = useState<AttentionLedgerEntry[]>(
    () => attentionLedgerCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!attentionLedgerCache.has(personaId));

  useEffect(() => {
    let alive = true;
    setEntries(attentionLedgerCache.get(personaId) ?? []);
    listAttentionLedger(personaId, 20)
      .then((rows) => {
        attentionLedgerCache.set(personaId, rows);
        if (alive) setEntries(rows);
      })
      .catch(silentCatch('life:attentionLedger'))
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [personaId]);

  const tracker = useRevealTracker(personaId);
  const verdictLabels: Record<string, string> = {
    started: life.ledger_verdict_started,
    acted: life.ledger_verdict_acted,
    noop: life.ledger_verdict_noop,
    refused: life.ledger_verdict_refused,
    failed: life.ledger_verdict_failed,
  };

  return (
    <div data-testid="life-resp-ledger">
      <SectionCard title={life.resp_ledger_title}>
        {entries.length === 0 ? (
          isLoading ? (
            // Calm geometry-matched ghost under the permanent card chrome.
            <div className="space-y-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 rounded-input bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <p className="typo-caption py-2">{life.resp_ledger_empty}</p>
          )
        ) : (
          <ul className="space-y-1" data-testid="life-resp-ledger-rows">
            {entries.map((e, i) => (
              <RevealItem key={e.id} as="li" revealId={e.id} order={i} {...tracker}>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-input hover:bg-secondary/30 transition-colors">
                  <StatusBadge size="sm" accent={e.kind === 'consolidation' ? 'violet' : 'cyan'}>
                    {e.kind === 'consolidation' ? life.ledger_kind_consolidation : life.ledger_kind_attention}
                  </StatusBadge>
                  {e.lane && <span className="typo-code text-foreground/85">{e.lane}</span>}
                  <StatusBadge size="sm" variant={VERDICT_VARIANT[e.verdict] ?? 'neutral'}>
                    {verdictLabels[e.verdict] ?? e.verdict}
                  </StatusBadge>
                  <span className="typo-caption flex-1 min-w-0 truncate">
                    {e.reason}
                  </span>
                  <RelativeTime timestamp={e.startedAt} className="typo-caption shrink-0" />
                </div>
              </RevealItem>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
