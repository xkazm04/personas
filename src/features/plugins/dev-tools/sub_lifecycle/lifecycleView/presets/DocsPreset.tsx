/**
 * DOCS preset: (a) how the docs are resolved - every judged doc as a bullet
 * under its status, worst first; (b) the clean share's make-up, one unit
 * per doc, with its n and the threshold (the step's own, else the snapshot's
 * rules; the share's ring is the step's instrument above); (c) the docs change
 * log - the changes that recorded a docs outcome - where a row opens the
 * change in a modal. Doc rows come from the step detail; the log from the
 * snapshot.
 */
import { useMemo, useState } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { Rows, Section, UnitStrip, type Glyph, type Tone } from '@/features/shared/components/kit';

import type { JourneyNode } from '../../journey/journeyModel';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { VERDICT, type HealthStep } from '../layer1/healthModel';
import { MetricValue } from '../layer1/parts/MetricValue';
import { RHYTHM } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { thresholdsFor } from '../system/rules';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { DocChangeModal } from './DocChangeModal';
import { DocsResolution, useDocStatusLabel } from './DocsResolution';
import { docsChangeLog, groupDocs, type DocGroup } from './docsModel';
import { EvidenceRows } from './EvidenceRows';
import type { PresetData } from './presetData';

/** One unit per judged doc, coloured by its verdict: the composition behind the clean share. */
const UNIT: Record<DocGroup['status'], { tone: Tone; glyph: Glyph }> = {
  broken: { tone: 'error', glyph: 'solid' },
  stale: { tone: 'warning', glyph: 'solid' },
  unverifiable: { tone: 'info', glyph: 'hollow' },
  clean: { tone: 'success', glyph: 'solid' },
};

/**
 * The clean share's ring is the step's instrument at the top of the screen;
 * here it gets what the ring cannot show: which docs make it up, one unit
 * each, beside its n and its threshold.
 */
function Composition({ step, node, groups }: { step: HealthStep; node: JourneyNode; groups: DocGroup[] }) {
  const { dl, tx } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  const metric = step.metrics.find((m) => m.key === 'docs_clean_pct') ?? null;
  const threshold = thresholdsFor(useSnapshotRules(), node.view.step.params).docsCleanPct;
  const total = groups.reduce((a, g) => a + g.docs.length, 0);
  return (
    <div className={`flex w-full max-w-xs shrink-0 flex-col ${RHYTHM.tight}`} data-testid="lc2-docs-share">
      <span className="flex items-baseline gap-2">
        {metric && <MetricValue metric={metric} className={`${LT.stat} ${VERDICT[step.health].ink}`} />}
        <span className={LT.row}>{dl.lc1_metric_docs_clean_pct}</span>
      </span>
      {metric && metric.value != null && <span className={LT.row}>{tx(dl.lc2_docs_verifiable, { count: metric.samples })}</span>}
      {total > 0 && (
        <UnitStrip
          size="l"
          rows={Math.max(1, Math.ceil(total / 12))}
          label={groups.map((g) => `${label(g.status)} ${g.docs.length}`).join(', ')}
          segments={groups.map((g) => ({ n: g.docs.length, ...UNIT[g.status] }))}
        />
      )}
      <span className={`flex items-baseline gap-1.5 ${LT.meta}`}>
        {dl.lc2_docs_threshold}
        <Numeric value={threshold} unit="percent" precision={0} className={LT.rowNum} />
      </span>
    </div>
  );
}

export function DocsPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data: PresetData }) {
  const { dl, evidence } = useLifecycleViewModel();
  const docs = data.detail?.docs;
  const groups = useMemo(() => groupDocs(docs ?? []), [docs]);
  const log = useMemo(() => docsChangeLog(evidence), [evidence]);
  const [opened, setOpened] = useState<EvidenceRow | null>(null);

  return (
    <>
      <Section title={dl.lc2_docs_resolved} level={2}>
        <div className={`flex flex-wrap items-start ${RHYTHM.inlineWide}`}>
          <Composition step={step} node={node} groups={groups} />
          <div className="min-w-0 flex-1">
            {/* Rows owns the ghost and the empty band; the resolution list is the populated state. */}
            {data.loading || groups.length === 0 ? (
              <Rows
                loading={data.loading}
                count={0}
                empty={{ title: data.unavailable ? dl.lc2_runs_unavailable : dl.lc2_docs_none, hint: data.unavailable ? undefined : dl.lc2_docs_none_hint }}
              >
                {null}
              </Rows>
            ) : (
              <DocsResolution groups={groups} />
            )}
          </div>
        </div>
      </Section>
      <Section title={dl.lc2_docs_log} level={2} count={log.length || undefined} desc={dl.lc2_docs_log_caption}>
        <EvidenceRows rows={log} empty={dl.lc2_docs_log_empty} onPress={setOpened} testId="lc2-docs-log" />
      </Section>
      <DocChangeModal row={opened} docs={docs ?? []} onClose={() => setOpened(null)} />
    </>
  );
}
