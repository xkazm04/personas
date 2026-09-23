// The dock's head: what the strip is showing, the three care filters (each
// with its count in the current scope) and the control that spreads or folds
// the full cross-section. The control says what it will do, and how tall the
// dock will get, before it is pressed.
import type { FocusEvent, MouseEvent } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import type { SubjectNode } from '../engine/types';
import { careKinds } from './fusedModel';
import { useFusedStore, type CareKind } from './fusedStore';
import { useFusedStrings } from './fusedStrings';

interface Props {
  all: SubjectNode[];
  careCount: number;
  scopeName: string;
  narrow: boolean;
  waitingStars: Set<string>;
}

const CHIPS: Array<{ kind: CareKind; tone: string }> = [
  { kind: 'waiting', tone: 'var(--gx-warn)' },
  { kind: 'pending', tone: 'var(--gx-warn)' },
  { kind: 'rejected', tone: 'var(--gx-err)' },
];

export function DockHead({ all, careCount, scopeName, narrow, waitingStars }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const spread = useFusedStore((st) => st.spread);
  const filters = useFusedStore((st) => st.filters);
  const setSpread = useFusedStore((st) => st.setSpread);
  const toggleFilter = useFusedStore((st) => st.toggleFilter);
  const setSay = useFusedStore((st) => st.setSay);
  const say = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => setSay({ kind: 'spread', rect: e.currentTarget.getBoundingClientRect() });
  const count = (k: CareKind) => all.filter((x) => careKinds(x, waitingStars).includes(k)).length;
  const label = (k: CareKind) => (k === 'waiting' ? f.chip_waiting : k === 'pending' ? f.chip_pending : f.chip_rejected);
  const spreadBtn = (
    <button
      className="cmd fz-spread-btn"
      type="button"
      data-role="hud-spread"
      onClick={() => {
        setSay(null);
        setSpread(!spread);
      }}
      onMouseEnter={say}
      onFocus={say}
      onMouseLeave={() => setSay(null)}
      onBlur={() => setSay(null)}
    >
      {spread ? f.dock_fold : tx(f.dock_spread, { count: s.n(all.length) })} <kbd>S</kbd>
    </button>
  );

  if (spread) {
    return (
      <div className="fz-dock-head" data-role="hud-dock-head">
        <span className="dh-t">
          <b>{f.dock_section}</b>
          {narrow ? null : ` · ${f.dock_section_sub}`}
        </span>
        <span className="lg">
          <i className="sw" style={{ background: 'var(--gx-ok)' }} />
          {f.legend_approved}
        </span>
        <span className="lg">
          <i className="sw" style={{ background: 'var(--gx-err)' }} />
          {f.legend_rejected}
        </span>
        <span className="lg">
          <i className="sw" style={{ background: 'var(--gx-warn)' }} />
          {f.legend_pending}
        </span>
        <span className="lg">
          <i className="sw" style={{ background: 'color-mix(in srgb, var(--gx-none) 50%, transparent)' }} />
          {f.legend_never}
        </span>
        {spreadBtn}
      </div>
    );
  }
  return (
    <div className="fz-dock-head" data-role="hud-dock-head">
      <span className="dh-t">
        <b>{f.dock_care}</b> · {tx(f.dock_care_count, { count: s.n(careCount), all: s.n(all.length) })}
        {narrow ? null : ` ${tx(f.dock_care_in, { scope: scopeName })}`}
      </span>
      <span className="chips">
        {CHIPS.map(({ kind, tone }) => (
          <button
            key={kind}
            className="chip"
            type="button"
            data-role="hud-chip"
            aria-pressed={filters[kind]}
            style={{ ['--c' as string]: tone }}
            onClick={() => toggleFilter(kind)}
          >
            <i />
            {label(kind)} <b>{s.n(count(kind))}</b>
          </button>
        ))}
      </span>
      {spreadBtn}
    </div>
  );
}

export default DockHead;
