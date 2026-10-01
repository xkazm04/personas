/**
 * Dossier (WP9): one section drawn as a kit Tile in one of its four faces.
 * - glance (layer one): title, the headline gauge top-right, the glance body.
 * - rail (L2, the other sections): title and gauge only; the cell presses.
 * - board (L2, the zoomed section): title, its hint, Back / Full detail and the
 *   gauge in the head; the section board as the body.
 * - stage: title and gauge (counting up when the answer landed here), the
 *   compact glance, and the answer's readout under it.
 */
import type { ReactNode, Ref } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';

import { KitButton, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { SectionBoard } from './board/SectionBoard';
import type { CellFace } from './DossierCell';
import { CoverageMeter } from './CoverageMeter';
import { DeltaReadout } from './DeltaReadout';
import { SectionGlance } from './glance/SectionGlance';

interface SectionTileProps {
  section: SectionId;
  face: CellFace;
  model: TwinBlueprintModel;
  coverage: number | null;
  reduced: boolean;
  onBack?: () => void;
  onOpenDetail?: (section: SectionId, itemKey?: string) => void;
  /** Layer one in a wide content area. */
  roomy?: boolean;
  /** Board: where keyboard focus lands when the board opens. */
  boardRef?: Ref<HTMLDivElement>;
  /** Stage: the delta, when the last answer landed on this section. */
  delta?: BlueprintDelta | null;
  working?: boolean;
}

export function SectionTile(props: SectionTileProps) {
  const { section, face, model, coverage, reduced, roomy, onBack, onOpenDetail, boardRef, delta = null, working } = props;
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const hot = face === 'stage' && delta !== null;
  const gauge = <CoverageMeter section={section} value={coverage} spring={hot} working={working} reduced={reduced} />;
  const noChannels = section === 'voice' && model.voice.channels.length === 0;

  let body: ReactNode = null;
  if (face === 'glance' || face === 'stage') {
    body = (
      <>
        <SectionGlance section={section} model={model} compact={face === 'stage'} roomy={roomy} delta={delta} spring={hot} reduced={reduced} />
        {hot && <DeltaReadout delta={delta} reduced={reduced} />}
      </>
    );
  } else if (face === 'board' && onOpenDetail) {
    body = (
      <div ref={boardRef} tabIndex={-1} role="region" aria-label={tb.sections[section]} className="dossier-board-focus">
        <SectionBoard section={section} model={model} roomy={roomy} onOpenDetail={onOpenDetail} reduced={reduced} />
      </div>
    );
  }

  const actions =
    face === 'board' ? (
      <>
        {onBack && (
          <KitButton tone="quiet" icon={<ArrowLeft />} onClick={onBack} testId="dossier-back">
            {tb.nav.back}
          </KitButton>
        )}
        {onOpenDetail && (
          <KitButton icon={<ArrowUpRight />} onClick={() => onOpenDetail(section)} testId="dossier-open-detail">
            {tb.nav.openDetail}
          </KitButton>
        )}
        {gauge}
      </>
    ) : (
      gauge
    );

  return (
    <Tile
      title={tb.sections[section]}
      meta={face === 'board' ? tb.sectionHints[section] : undefined}
      actions={actions}
      state={noChannels && face !== 'rail' ? 'empty' : undefined}
      empty={{ title: tb.states.emptyVoice }}
      testId={`dossier-tile-${section}`}
    >
      {face === 'rail' ? undefined : body}
    </Tile>
  );
}
