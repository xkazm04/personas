// The evidence ledger's row model: the snapshot's evidence window joined to ONE
// step. Pure, so the three variants and the unit test read the same join.
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

export interface EvidenceRow {
  /** `${sourceKind}:${sourceRef}` - unique within one snapshot's window. */
  key: string;
  item: LifecycleEvidenceItem;
  /** This change's outcome FOR THE JOINED STEP. `unknown` when it recorded none. */
  outcome: LifecycleOutcome;
  /** The step-specific note, or null. Never substituted with a tally or a zero. */
  detail: string | null;
}

export function evidenceRowsFor(stepId: string | null, evidence: LifecycleEvidenceItem[]): EvidenceRow[] {
  if (!stepId) return [];
  return evidence.map((item) => {
    const hit = item.outcomes.find((o) => o.stepId === stepId);
    return {
      key: `${item.sourceKind}:${item.sourceRef}`,
      item,
      outcome: hit?.outcome ?? 'unknown',
      detail: hit?.detail ?? null,
    };
  });
}
