// What the open deed's controls do. `a` runs the one action its state allows
// (the page's own `featureCta`), `m` asks to switch its tier, and every write
// goes through a confirmation, then carries a real spinner on the control that
// started it until the page's write settles.
//
// A rehearsal copy acts on the feature it copies: the 100-row roster is a
// layout rehearsal, not a hundred features. The write the page is asked to make
// is kept as `lastWrite` (`tier:<feature id>:<tier>`) so a drive can assert on
// what would be sent; in fixture mode the page then refuses it, as the Board
// does.
import { useCallback, useState } from 'react';

import type { FeatureRow } from '../featureRules';
import type { FeaturesModel } from '../featuresModel';
import type { CadRow } from './cadastreModel';
import { deedCta, type DeedAsk } from './DeedActions';

export interface DeedActionDoors {
  onOpenDecision: (subjectId: string) => void;
  onRunCouncil: (row: FeatureRow) => void;
  onToggleTier: (row: FeatureRow) => Promise<void>;
}

export function useDeedActions(model: FeaturesModel, selected: CadRow | null, doors: DeedActionDoors) {
  const [ask, setAsk] = useState<DeedAsk>(null);
  const [busy, setBusy] = useState<DeedAsk>(null);
  const [lastWrite, setLastWrite] = useState('');

  const base = useCallback((r: CadRow): FeatureRow => model.rowById.get(r.row.feature.id.split('~')[0]!) ?? r.row, [model]);

  const runAction = useCallback(() => {
    if (!selected) return;
    const cta = deedCta(selected);
    const row = base(selected);
    if (cta === 'open_decision' && row.feature.council) doors.onOpenDecision(row.feature.council.id);
    else if (cta === 'run' || cta === 'next_round') doors.onRunCouncil(row);
    else if (cta === 'promote') setAsk('promote');
  }, [selected, base, doors]);

  const write = useCallback(async (kind: 'promote' | 'tier') => {
    if (!selected) return;
    const row = base(selected);
    setAsk(null);
    setBusy(kind);
    setLastWrite(`tier:${row.feature.id}:${row.feature.tier === 'major' ? 'standard' : 'major'}`);
    try {
      await doors.onToggleTier(row);
    } finally {
      setBusy(null);
    }
  }, [selected, base, doors]);

  const confirmPromote = useCallback(() => write('promote'), [write]);
  const confirmTier = useCallback(() => write('tier'), [write]);

  return { ask, setAsk, busy, lastWrite, runAction, confirmPromote, confirmTier };
}
