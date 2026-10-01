import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { SectionId } from '../../blueprintContract';
import { RegionInk, RegionOutline } from './InkFrame';
import { Balloon, Letter, Unmeasured } from './Lettering';
import { inkOf } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import { WriteNumber } from './draw/Write';

/**
 * One region of the twin plan: a numbered balloon and the section's name in
 * drafting lettering, its share drawn as a figure, and the region's own
 * drawing inside an outline inked as far as the section is drawn. On layer
 * one the whole region is the door to its zoom (Tab, Enter or Space), from
 * the first frame on: the draw-in never holds the keyboard or the pointer.
 *
 * In the draw-in the region is a box (its pencil outline is a depth-0 frame)
 * and a container: after every frame on the sheet has traced, it writes its
 * own parts in order (balloon, name, share, the ink running out to the share,
 * the tick), while each drawing inside it writes its own parts alongside.
 */
export default function SheetRegion({
  section,
  number,
  coverage,
  onActivate,
  unmeasuredLabel,
  targeted = false,
  regionRef,
  dense = false,
  className = '',
  style,
  children,
}: {
  section: SectionId;
  number: number;
  coverage: number | null;
  /** Layer one: the region opens its zoom. Absent: the region is a static drawing. */
  onActivate?: () => void;
  /** Said beside the balloon when the section has nothing to measure yet. */
  unmeasuredLabel: string;
  /** The last answer landed in this region (stage mode). */
  targeted?: boolean;
  regionRef?: Ref<HTMLDivElement>;
  /** Stage mode: tighter padding, the column beside the card is narrow. */
  dense?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const name = t.twin.blueprint.sections[section];
  const ink = inkOf(coverage);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onActivate || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onActivate();
  };

  return (
    <div
      ref={regionRef}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? name : undefined}
      onClick={onActivate}
      onKeyDown={onActivate ? onKeyDown : undefined}
      data-testid={`twd-region-${section}`}
      data-section={section}
      data-ink={ink}
      data-measured={coverage === null ? 'false' : 'true'}
      data-draw-scope=""
      className={`twd-region focus-ring relative flex min-h-0 min-w-0 flex-col ${dense ? 'gap-2 px-2.5 pb-3 pt-2' : 'gap-3 px-4 pb-4 pt-3'} ${targeted ? 'twd-target' : ''} ${className}`}
      style={style}
    >
      <RegionOutline />
      <header className="flex min-w-0 items-center gap-2.5">
        <Balloon number={number} inked={ink !== 'pending' && ink !== 'unmeasured'} />
        <Letter strong className="min-w-0 truncate">
          {name}
        </Letter>
        {/* Beside the card (dense) the inked frame alone draws the share; the figure needs the width. */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {coverage === null && (
            <Tooltip content={unmeasuredLabel}>
              <span className="relative flex h-4 w-8 items-center" style={{ border: '1px solid transparent' }}>
                <DrawFrame stroke="var(--ink-dim)" />
                <Unmeasured className="h-full w-full" />
                <span className="sr-only">{unmeasuredLabel}</span>
              </span>
            </Tooltip>
          )}
          {coverage !== null && !dense && <WriteNumber value={coverage} unit="ratio" precision={0} className="typo-data text-foreground" />}
        </span>
      </header>
      <RegionInk coverage={coverage} ink={ink} />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${dense ? 'gap-2' : 'gap-3'}`}>{children}</div>
    </div>
  );
}
