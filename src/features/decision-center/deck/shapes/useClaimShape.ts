/**
 * The Accept (claim) card's audit: a random sample of the mandate's acts,
 * one of them picked (`1`-`3`), and two doors on the picked act: revert
 * (`V`) and narrow the scope it was taken under (`N`). Both are the mandate
 * page's own doors (`useMandateDoors`), so a refusal (an irreversible act, an
 * act already reverted) is said in place, never thrown. Accepting or sending
 * the claim back stays on `A` / `R`, the card's own verdict.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { useMandateDoors } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandateDoors';
import type { DecisionItem } from '../../model/decisionModel';
import { auditable, sampleActs } from '../../mandate/claimModel';
import { useClaimAudit } from '../../mandate/useClaimAudit';
import type { ShapeRoute } from './cardShape';

export interface ClaimShape {
  /** null while the act log is read (or when no mandate holds the project). */
  sample: CharterAct[] | null;
  /** All auditable acts the sample was drawn from. */
  total: number;
  failed: boolean;
  /** No mandate holds the claim's project: nothing to audit. */
  orphan: boolean;
  picked: number | null;
  pick: (index: number) => boolean;
  revert: () => void;
  narrow: () => void;
  notice: string | null;
}

export function useClaimShape(active: boolean, item: DecisionItem | undefined, route: ShapeRoute | null, mandate: MandateSummary | null): ClaimShape {
  const charterId = active ? route?.charterId ?? null : null;
  const audit = useClaimAudit(charterId);
  const sample = useMemo(
    () => (audit.acts && item ? sampleActs(audit.acts, item.id) : null),
    [audit.acts, item],
  );
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => { setPicked(null); }, [item?.id]);
  const act = picked !== null ? sample?.[picked] ?? null : null;
  const doors = useMandateDoors(mandate, act, audit.refresh);
  const { setNotice } = doors;

  const pick = (index: number): boolean => {
    if (!sample?.[index]) return false;
    setPicked(index);
    setNotice(null);
    return true;
  };

  return {
    sample,
    total: audit.acts ? auditable(audit.acts).length : 0,
    failed: audit.failed,
    orphan: active && !route?.charterId,
    picked,
    pick,
    revert: () => { if (act) void doors.revert(); },
    narrow: () => { if (act) void doors.narrow(); },
    notice: doors.notice,
  };
}
