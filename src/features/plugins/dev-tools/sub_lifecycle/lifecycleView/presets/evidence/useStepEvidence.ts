// Everything the evidence sections of one step draw, derived once per render
// of its data: the rows (detail joined with the snapshot window, newest
// first), the adherence series, the reason clusters and the source split.
// The clock is read once per row set, so a re-render does not move the weeks.
import { useMemo } from 'react';

import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import type { PresetData } from '../presetData';
import { adherence, type Adherence } from './adherence';
import { stepEvidenceRows } from './evidenceModel';
import { clusterReasons, type ReasonSummary } from './reasons';
import { sourceBreakdown, type SourceSlice } from './sources';

export interface StepEvidence {
  rows: EvidenceRow[];
  series: Adherence;
  reasons: ReasonSummary;
  sources: SourceSlice[];
  minSamples: number;
  /** The detail read is still out and the snapshot holds nothing for the step. */
  loading: boolean;
}

export function useStepEvidence(stepId: string, data: PresetData | undefined): StepEvidence {
  const { evidence } = useLifecycleViewModel();
  const { minSamples } = useSnapshotRules();
  const detail = data?.detail?.evidence;
  const rows = useMemo(() => stepEvidenceRows(stepId, detail ?? [], evidence), [stepId, detail, evidence]);
  const derived = useMemo(() => ({
    series: adherence(rows.map((r) => ({ outcome: r.outcome, occurredAt: r.item.occurredAt })), { minSamples, now: Date.now() }),
    reasons: clusterReasons(rows),
    sources: sourceBreakdown(rows, minSamples),
  }), [rows, minSamples]);
  return { rows, ...derived, minSamples, loading: !!data?.loading && rows.length === 0 };
}
