import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import { LETTER_STYLE } from './Lettering';
import ReadinessSlots from './ReadinessSlots';

/**
 * The plan's title block, in the corner where a drafter puts it (the idiom of
 * Studio's DraftingTitleBlock, whose cells are a site build's and not a
 * twin's): the twin's name and role, and readiness as a stamp beside its four
 * slots. The stamp lands when the sheet is drawn.
 */
export default function TwinTitleBlock({
  model,
  drawn,
  reduced,
  slots = true,
}: {
  model: TwinBlueprintModel;
  drawn: boolean;
  reduced: boolean;
  /** Stage mode leaves the slots out: the title block shares a band with the card. */
  slots?: boolean;
}) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const { identity, readiness } = model;
  const stamp = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: drawn ? 1 : 0 } }
    : {
        initial: { opacity: 0, scale: 2.4, rotate: -6 },
        animate: drawn ? { opacity: 1, scale: 1, rotate: -6 } : { opacity: 0, scale: 2.4, rotate: -6 },
      };

  return (
    <div
      data-testid="twd-title-block"
      className="relative flex min-w-0 flex-wrap"
      style={{ border: '1px solid var(--ink)', background: 'color-mix(in srgb, var(--paper) 92%, transparent)' }}
    >
      <Cell label={b.variantCopy.drafting.sheetTitle} grow>
        <p className="line-clamp-2 typo-title-lg" style={{ color: 'var(--ink-strong)' }}>
          {identity.name}
        </p>
        <p className="line-clamp-2 typo-caption">{identity.role ?? t.twin.experience.sheet.noRole}</p>
      </Cell>
      <Cell label={b.metrics.readiness}>
        <div className="flex items-center gap-4">
          <motion.span
            {...stamp}
            transition={{ type: 'spring', stiffness: 380, damping: 16, delay: reduced ? 0 : 0.2 }}
            className="inline-flex shrink-0 items-baseline rounded-interactive px-2.5"
            style={{ border: '2.5px solid var(--ink-strong)', boxShadow: '0 0 18px color-mix(in srgb, var(--primary) 20%, transparent)' }}
            data-readiness={readiness.score}
          >
            <Numeric value={readiness.score} className="typo-data-lg" />
          </motion.span>
          {slots && <ReadinessSlots slots={readiness.slots} />}
        </div>
      </Cell>
    </div>
  );
}

function Cell({ label, children, grow = false }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col gap-1 px-3 py-2 ${grow ? 'flex-1 basis-56' : ''}`}
      style={{ outline: '1px solid var(--ink-faint)', color: 'var(--ink-strong)' }}
    >
      <span className="typo-label" style={{ ...LETTER_STYLE, color: 'var(--ink)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
