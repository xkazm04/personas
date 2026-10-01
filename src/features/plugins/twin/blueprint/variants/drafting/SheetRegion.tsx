import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { SectionId } from '../../blueprintContract';
import InkFrame from './InkFrame';
import { Balloon, Letter, Unmeasured } from './Lettering';
import { inkOf } from './draftingTwinModel';

/**
 * One region of the twin plan: a numbered balloon and the section's name in
 * drafting lettering, its share drawn as a figure, and the region's own
 * drawing inside an outline inked as far as the section is drawn. On layer
 * one the whole region is the door to its zoom (Tab, Enter or Space); a
 * region not yet reached by the build-up keeps its place, undrawn, so the
 * sheet never reflows while it draws itself in.
 */
export default function SheetRegion({
  section,
  number,
  coverage,
  drawn,
  reduced,
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
  drawn: boolean;
  reduced: boolean;
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
  const wipe = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: drawn ? 1 : 0 } }
    : { initial: { clipPath: 'inset(0 100% 0 0)' }, animate: { clipPath: drawn ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' } };

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
      data-drawn={drawn}
      data-measured={coverage === null ? 'false' : 'true'}
      className={`twd-region focus-ring relative flex min-h-0 min-w-0 flex-col ${dense ? 'gap-2 px-2.5 pb-3 pt-2' : 'gap-3 px-4 pb-4 pt-3'} ${targeted ? 'twd-target' : ''} ${className}`}
      style={style}
    >
      <InkFrame coverage={coverage} ink={ink} drawn={drawn} reduced={reduced} />
      <motion.div
        {...wipe}
        transition={{ duration: reduced ? 0.25 : 0.8, ease: 'easeOut' }}
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${dense ? 'gap-2' : 'gap-3'}`}
      >
        <header className="flex min-w-0 items-center gap-2.5">
          <Balloon inked={ink !== 'pending' && ink !== 'unmeasured'}>{number}</Balloon>
          <Letter strong className="min-w-0 truncate">
            {name}
          </Letter>
          {/* Beside the card (dense) the inked frame alone draws the share; the figure needs the width. */}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {coverage === null && (
              <Tooltip content={unmeasuredLabel}>
                <span className="flex items-center">
                  <Unmeasured className="h-4 w-8" style={{ border: '1px solid var(--ink-dim)' }} />
                  <span className="sr-only">{unmeasuredLabel}</span>
                </span>
              </Tooltip>
            )}
            {coverage !== null && !dense && <Numeric value={coverage} unit="ratio" precision={0} className="typo-data text-foreground" />}
          </span>
        </header>
        {children}
      </motion.div>
    </div>
  );
}
