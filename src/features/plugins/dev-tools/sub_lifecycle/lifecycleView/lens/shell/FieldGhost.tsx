/**
 * The field before its data lands (loading pattern v2): the Solo practice's
 * ten columns in their real geometry, every slot empty and inert, the lanes
 * and the step names already in place, so the real field paints over it
 * without a shift. Delayed a beat, so a warm load never flashes it.
 */
import { memo } from 'react';

import { stepLabel } from '../../../journey/journeyLabels';
import type { Dl } from '../model/lensWords';
import { Field, type FieldColumn } from './Field';

const SOLO: { id: string; phase: 'before' | 'after' }[] = [
  { id: 'frame', phase: 'before' }, { id: 'recall', phase: 'before' }, { id: 'isolate', phase: 'before' }, { id: 'sync', phase: 'before' },
  { id: 'gate', phase: 'after' }, { id: 'tests', phase: 'after' }, { id: 'docs', phase: 'after' },
  { id: 'commit', phase: 'after' }, { id: 'land', phase: 'after' }, { id: 'record', phase: 'after' },
];
const SLOTS = 20;
const noop = () => {};

export const FieldGhost = memo(function FieldGhost({ dl }: { dl: Dl }) {
  const columns: FieldColumn[] = SOLO.map((s) => ({
    id: s.id,
    name: stepLabel(dl, s.id),
    phase: s.phase,
    lit: false,
    fault: false,
    foot: { text: ' ', tone: 'quiet' },
    cells: Array.from({ length: SLOTS }, (_, i) => ({ key: `${s.id}-ghost-${i}`, tone: 'none', pointer: null, label: '' })),
    label: stepLabel(dl, s.id),
  }));
  return (
    <div className="lens-ghost contents" aria-busy="true" data-testid="lens-field-ghost">
      <Field
        columns={columns}
        intro={false}
        label={dl.lens_field_aria}
        lanes={{ before: dl.lc_lane_before, after: dl.lc_lane_after }}
        onSelect={noop}
        onOpenColumn={noop}
        onOpenCell={noop}
        testId="lens-field-ghost-columns"
      />
    </div>
  );
});
