// Layer 2 of the wall: the eight lamps fold into a rail (still lit, still
// one keypress each) and the chosen dimension gets the window. Crumbs say
// where you are and are the way back; Esc does the same; Up/Down walk the
// rail without leaving layer 2.

import { useCallback } from 'react';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import { Crumbs, ListRow, Section } from '@/features/shared/components/kit';
import { VERDICT_TONE } from '../shared/readings';
import { DIM_ORDER, type DimId, type DimState } from '../shared/dimensions';
import type { MissionReadings } from '../shared/useMissionReadings';
import { DimDetail } from '../shared/details/DimDetail';
import { isTyping } from '../shared/useDimKeys';

export function WallDetail({ open, dims, readings, onOpen, onBack }: {
  open: DimId;
  dims: Record<DimId, DimState>;
  readings: MissionReadings;
  onOpen: (id: DimId) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const ml = t.overview.mission_layers;
  const dim = dims[open];

  const walk = useCallback((e: KeyboardEvent): boolean => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target)) return false;
    e.preventDefault();
    const i = DIM_ORDER.indexOf(open);
    const next = (i + (e.key === 'ArrowDown' ? 1 : DIM_ORDER.length - 1)) % DIM_ORDER.length;
    onOpen(DIM_ORDER[next]!);
    return true;
  }, [open, onOpen]);
  useAppKeyboard(walk, { priority: ROUTE_DECISION_PRIORITY });

  return (
    <div className="aw-layer2">
      <nav className="aw-rail" aria-label={ml.layer_label}>
        {DIM_ORDER.map((id, i) => {
          const d = dims[id];
          return (
            <div key={id} className="aw-rail__item" data-verdict={d.verdict}>
              <ListRow
                size="m"
                name={d.label}
                meta={d.stateLabel}
                mark={{ tone: VERDICT_TONE[d.verdict], glyph: d.verdict === 'pending' ? 'hollow' : 'solid', label: d.stateLabel }}
                figures={<span className="aw-rail__fig typo-data">{d.value ?? '-'}<kbd className="aw-key typo-code">{i + 1}</kbd></span>}
                state={id === open ? 'selected' : undefined}
                onPress={() => onOpen(id)}
                testId={`mc-rail-${id}`}
              />
            </div>
          );
        })}
      </nav>
      <div className="aw-pane" data-verdict={dim.verdict}>
        <Crumbs
          label={ml.layer_label}
          items={[
            { label: t.overview.dashboard.mission_control_eyebrow, onPress: onBack, testId: 'mc-crumb-home' },
            { label: dim.label },
          ]}
        />
        <Section
          title={<><span className="mc-lamp" aria-hidden="true" />{dim.label}</>}
          count={dim.value ?? undefined}
          meta={dim.stateLabel}
          desc={<>{dim.question} {dim.note}</>}
        >
          <div className="aw-pane__body">
            <DimDetail id={open} readings={readings} />
          </div>
        </Section>
      </div>
    </div>
  );
}
