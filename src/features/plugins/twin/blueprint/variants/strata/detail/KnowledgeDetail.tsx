/**
 * Knowledge at L2: the memory ledger (approved, awaiting review, rejected) as
 * three figures over a hundred-cell waffle of their shares, then the distilled
 * facts as a tick strip, the knowledge-base binding and the sample proposals
 * waiting for review. Unmeasured counts print "-" over a hatched band.
 */
import { Database, Unplug } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { StrataFigure } from '../StrataFigure';
import { FACT_TICKS, apportionCells } from '../strataModel';
import { PressRow } from './StrataMeter';

/** The waffle is a share of the total: 100 cells = every memory, whatever the count. */
const SHARE_CELLS = 100;

export function KnowledgeDetail({ model, onOpen }: { model: TwinBlueprintModel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tm = t.twin.blueprint.metrics;
  const { memories, facts, kbBound } = model.knowledge;
  const parts = [
    { key: 'approved', label: tm.approved, value: memories.approved },
    { key: 'pending', label: tm.awaiting, value: memories.pending },
    { key: 'rejected', label: tm.rejected, value: memories.rejected },
  ] as const;
  const measured = parts.some((p) => p.value !== null);
  const cells = apportionCells(parts.map((p) => p.value ?? 0), SHARE_CELLS);
  const kinds = parts.flatMap((p, i) => Array.from({ length: cells[i] ?? 0 }, () => p.key));

  return (
    <div className="flex flex-col gap-4">
      <PressRow label={tm.memories} onPress={() => onOpen('memories')} className="strata-block" testId="strata-item-memories">
        <span className="typo-label text-primary">{tm.memories}</span>
        <div className="strata-ledger">
          {parts.map((p) => (
            <span key={p.key} className="flex flex-col gap-1 min-w-0" data-part={p.key}>
              <span className="inline-flex items-center gap-2 min-w-0">
                <i className={`strata-swatch is-${p.key}`} aria-hidden />
                <span className="typo-caption truncate">{p.label}</span>
              </span>
              <StrataFigure value={p.value} className="typo-data-lg text-foreground" />
            </span>
          ))}
        </div>
        {measured && kinds.length > 0 ? (
          <span className="strata-waffle" aria-hidden>
            {kinds.map((k, i) => <i key={i} className={`strata-swatch is-${k}`} />)}
          </span>
        ) : (
          <span className="strata-meter strata-meter--lg is-unmeasured" data-measured={measured ? 'true' : 'false'} aria-hidden />
        )}
      </PressRow>

      <div className="strata-three">
        <PressRow label={tm.facts} onPress={() => onOpen('facts')} className="strata-block" testId="strata-item-facts">
          <span className="typo-label text-primary">{tm.facts}</span>
          <StrataFigure value={facts} className="typo-data-lg text-foreground" />
          {facts === null ? (
            <span className="strata-meter is-unmeasured" data-measured="false" aria-hidden />
          ) : (
            <span className="strata-ticks" data-overflow={facts > FACT_TICKS ? 'true' : undefined} aria-hidden>
              {Array.from({ length: Math.min(facts, FACT_TICKS) }, (_, i) => <i key={i} />)}
            </span>
          )}
        </PressRow>
        <PressRow label={tm.knowledgeBase} onPress={() => onOpen('kb')} className="strata-block" testId="strata-item-kb">
          <span className="typo-label text-primary">{tm.knowledgeBase}</span>
          <span className="inline-flex items-center gap-2" data-bound={kbBound ? 'true' : 'false'}>
            {kbBound ? <Database className="w-5 h-5 text-primary" aria-hidden /> : <Unplug className="w-5 h-5 text-foreground" aria-hidden />}
            <span className="typo-heading text-foreground">{kbBound ? tm.kbBound : tm.kbUnbound}</span>
          </span>
        </PressRow>
        <PressRow label={tm.samplesOpen} onPress={() => onOpen('samples')} className="strata-block" testId="strata-item-samples">
          <span className="typo-label text-primary">{tm.samplesOpen}</span>
          <StrataFigure value={model.samples.open} className="typo-data-lg text-foreground" />
        </PressRow>
      </div>
    </div>
  );
}
