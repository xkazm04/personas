/**
 * Dossier (WP9), the Detail page body: one kit Tiles bento of the four section
 * tiles (layer one), and - when a section is chosen - the same four cells
 * re-laid: the other three shrink into a rail of pressable gauges on top and
 * the chosen one grows into a full-width section board (L2). The cells keep
 * their identity across the change, so framer's layout travel carries each
 * tile to its new place and size; under reduced motion the faces only fade.
 *
 * Keyboard: each tile (and each rail gauge) is one tab stop named by its
 * section; Enter/Space opens it. Opening moves focus into the board; Back (or
 * the shell's Escape) returns it to the tile that was opened.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { SECTION_IDS, type SectionId, type TwinBlueprintModel } from '../../blueprintContract';
import { sectionCoverage } from '../../sectionMetrics';
import { DossierCell, type CellFace } from './DossierCell';
import { ROOMY_AT } from './dossierModel';
import { SectionTile } from './SectionTile';
import { useRoomy } from './useRoomy';

/** Layer one's bento on 12 columns: the two lean sections beside the two wide ones. */
const L1_SPAN: Record<SectionId, number> = { identity: 4, voice: 8, knowledge: 4, training: 8 };

interface DossierDetailProps {
  model: TwinBlueprintModel;
  focus: SectionId | null;
  onFocus: (section: SectionId | null) => void;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
  reduced: boolean;
}

export function DossierDetail({ model, focus, onFocus, onOpenDetail, reduced }: DossierDetailProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const coverage = useMemo(() => sectionCoverage(model), [model]);
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pressRefs = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});
  const opened = useRef<SectionId | null>(null);
  const movedByUs = useRef(false);
  const roomy = useRoomy(rootRef, ROOMY_AT);

  const open = useCallback(
    (section: SectionId) => {
      movedByUs.current = true;
      opened.current = section;
      onFocus(section);
    },
    [onFocus],
  );
  const back = useCallback(() => onFocus(null), [onFocus]);

  // Keyboard focus follows the layer: into the board when we opened it, back
  // to the opened tile when the board closes (only if focus was ours to move).
  useEffect(() => {
    const active = document.activeElement;
    const ours = active === document.body || (active !== null && !!rootRef.current?.contains(active));
    if (focus) {
      if (movedByUs.current || ours) boardRef.current?.focus({ preventScroll: true });
      opened.current = focus;
    } else if (opened.current && ours) {
      pressRefs.current[opened.current]?.focus({ preventScroll: true });
      opened.current = null;
    }
    movedByUs.current = false;
  }, [focus]);

  const order: readonly SectionId[] = focus ? [...SECTION_IDS.filter((s) => s !== focus), focus] : SECTION_IDS;

  return (
    <div ref={rootRef} className="dossier-detail" data-layer={focus ? 'board' : 'overview'} data-roomy={roomy ? 'true' : undefined}>
      <Tiles label={tb.variantCopy.dossier.heroLabel}>
        {order.map((section) => {
          const face: CellFace = !focus ? 'glance' : section === focus ? 'board' : 'rail';
          return (
            <DossierCell
              key={section}
              section={section}
              face={face}
              span={face === 'glance' ? L1_SPAN[section] : face === 'board' ? 12 : 4}
              onPress={face === 'board' ? undefined : () => open(section)}
              pressLabel={tb.sections[section]}
              pressRef={(el) => {
                pressRefs.current[section] = el;
              }}
              reduced={reduced}
            >
              <SectionTile
                section={section}
                face={face}
                model={model}
                coverage={coverage[section]}
                reduced={reduced}
                roomy={roomy}
                onBack={back}
                onOpenDetail={onOpenDetail}
                boardRef={face === 'board' ? boardRef : undefined}
              />
            </DossierCell>
          );
        })}
      </Tiles>
    </div>
  );
}
