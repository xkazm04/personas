import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { LETTER_STYLE } from './Lettering';
import ReadinessSlots from './ReadinessSlots';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';

/**
 * The plan's title block, in the corner where a drafter puts it (the idiom of
 * Studio's DraftingTitleBlock, whose cells are a site build's and not a
 * twin's): the twin's name and role, and readiness as a stamp beside its four
 * slots. In the draw-in the block and its cells are frames (depth 0 and 1),
 * each cell letters its own words, and the readiness stamp is pressed last,
 * once every other part of the sheet is drawn.
 */
export default function TwinTitleBlock({
  model,
  slots = true,
}: {
  model: TwinBlueprintModel;
  /** Stage mode leaves the slots out: the title block shares a band with the card. */
  slots?: boolean;
}) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const { identity, readiness } = model;

  return (
    <div
      data-testid="twd-title-block"
      className="relative flex min-w-0 flex-wrap"
      style={{ border: '1px solid transparent', background: 'color-mix(in srgb, var(--paper) 92%, transparent)' }}
    >
      <DrawFrame stroke="var(--ink)" />
      <Cell label={b.variantCopy.drafting.sheetTitle} grow>
        <p className="line-clamp-2 typo-title-lg" style={{ color: 'var(--ink-strong)' }}>
          <Write text={identity.name} />
        </p>
        <p className="line-clamp-2 typo-caption">
          <Write text={identity.role ?? t.twin.experience.sheet.noRole} />
        </p>
      </Cell>
      <Cell label={b.metrics.readiness}>
        <div className="flex items-center gap-4">
          <span
            data-draw="press"
            className="inline-flex shrink-0 items-baseline rounded-interactive px-2.5"
            style={{
              border: '2.5px solid var(--ink-strong)',
              boxShadow: '0 0 18px color-mix(in srgb, var(--primary) 20%, transparent)',
              rotate: '-6deg',
            }}
            data-readiness={readiness.score}
          >
            <Numeric value={readiness.score} className="typo-data-lg" />
          </span>
          {slots && <ReadinessSlots slots={readiness.slots} />}
        </div>
      </Cell>
    </div>
  );
}

function Cell({ label, children, grow = false }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-col gap-1 px-3 py-2 ${grow ? 'flex-1 basis-56' : ''}`}
      style={{ color: 'var(--ink-strong)' }}
      data-draw-scope=""
    >
      <DrawFrame stroke="var(--ink-faint)" />
      <span className="typo-label" style={{ ...LETTER_STYLE, color: 'var(--ink)' }}>
        <Write text={label} />
      </span>
      {children}
    </div>
  );
}
