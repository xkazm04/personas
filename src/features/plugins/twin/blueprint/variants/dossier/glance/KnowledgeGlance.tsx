/**
 * Dossier (WP9), Knowledge at a glance: the memories as one apportioned kit
 * unit strip (approved, awaiting review, rejected), then a ledger - each count
 * beside its glyph, the distilled facts and (layer one) whether a knowledge
 * base is bound. A count the model could not measure draws "-", never 0; when
 * none of the three memory counts is measured the strip itself is hatched.
 */
import type { ReactNode } from 'react';

import { Dot, UnitStrip, apportion, quantumFor, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { MEMORY_UNITS_PER_ROW, memoriesUnmeasured } from '../dossierModel';
import { Figure, NotMeasured } from '../Figure';
import type { GlanceProps } from './glanceTypes';

type MemoryKey = 'approved' | 'pending' | 'rejected';
const MEMORY_PARTS: ReadonlyArray<{ key: MemoryKey; tone: Tone; glyph: 'solid' | 'soft' }> = [
  { key: 'approved', tone: 'success', glyph: 'solid' },
  { key: 'pending', tone: 'pending', glyph: 'solid' },
  { key: 'rejected', tone: 'error', glyph: 'soft' },
];

function LedgerRow({ glyph, label, value }: { glyph?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="dossier-ledger__row">
      <span className="dossier-ledger__glyph">{glyph}</span>
      <span className="typo-label dossier-key">{label}</span>
      <span className="dossier-ledger__value">{value}</span>
    </div>
  );
}

export function KnowledgeGlance({ model, compact, roomy, spring, reduced }: GlanceProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const { memories, facts, kbBound } = model.knowledge;
  const rows = 2;
  const label: Record<MemoryKey, string> = { approved: tb.metrics.approved, pending: tb.metrics.awaiting, rejected: tb.metrics.rejected };
  const spoken = (n: number | null) => (n === null ? tb.states.notMeasured : n);

  const total = MEMORY_PARTS.reduce((s, p) => s + (memories[p.key] ?? 0), 0);
  const quantum = quantumFor(total, MEMORY_UNITS_PER_ROW * rows);

  return (
    <div className="dossier-glance" data-testid="dossier-knowledge">
      <div className="dossier-line k-in">
        {memoriesUnmeasured(memories) ? (
          <NotMeasured width="var(--dz-mem-w)" height="var(--dz-mem-h)" testId="dossier-memories-none" />
        ) : (
          <UnitStrip
            size={roomy ? 'l' : 'm'}
            rows={rows}
            segments={apportion(
              MEMORY_PARTS.map((p) => ({ value: memories[p.key] ?? 0, tone: p.tone, glyph: p.glyph })),
              quantum,
            )}
            label={tx(copy.memoriesAria, {
              approved: spoken(memories.approved),
              pending: spoken(memories.pending),
              rejected: spoken(memories.rejected),
            })}
            legend={quantum > 1 ? tx(copy.memoryUnit, { count: quantum }) : undefined}
          />
        )}
      </div>
      <div className="dossier-ledger k-in">
        {MEMORY_PARTS.map((p) => (
          <LedgerRow
            key={p.key}
            glyph={<Dot tone={p.tone} glyph={p.glyph} />}
            label={label[p.key]}
            value={<Figure value={memories[p.key]} spring={spring} reduced={reduced} testId={`dossier-mem-${p.key}`} />}
          />
        ))}
        <LedgerRow label={tb.metrics.facts} value={<Figure value={facts} spring={spring} reduced={reduced} testId="dossier-facts" />} />
        {(!compact || roomy) && (
          <LedgerRow
            glyph={<Dot tone={kbBound ? 'success' : 'neutral'} glyph={kbBound ? 'solid' : 'hollow'} />}
            label={tb.metrics.knowledgeBase}
            value={
              <span className="typo-data" data-testid="dossier-kb" data-bound={kbBound ? 'true' : 'false'}>
                {kbBound ? tb.metrics.kbBound : tb.metrics.kbUnbound}
              </span>
            }
          />
        )}
      </div>
    </div>
  );
}
