// The ledger's feature chip: the Layers count on a context row.
//
// Interactive ONLY when this context actually has features on it: no feature,
// no affordance. When the project HAS features but none of them is linked to
// any context - the state a rename-losing rescan leaves behind - the chip says
// so in words instead of rendering a confident `0`.
import { useCallback, useRef, useState } from 'react';
import { Layers } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import { interpolate } from '@/i18n/useTranslation';

import type { TDevTools } from './contextLedgerShared';
import { buildCouncilDispatch } from './councilDispatch';
import type { FeatureChipContext } from './featureChipContext';
import type { FeatureRowModel } from './FeaturePopoverRow';
import { FeaturePopover } from './FeaturePopover';

export function FeatureChip({
  contextName,
  useCases,
  chip,
  t,
}: {
  contextName: string;
  /** The features slicing THIS context — the chip's count and the popover's
   *  list are the same array. */
  useCases: DevUseCase[];
  chip: FeatureChipContext;
  t: TDevTools;
}) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = useCases.length;

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const dispatch = useCallback((row: FeatureRowModel) => {
    if (!chip.project) return;
    setOpen(false);
    setRequest(
      buildCouncilDispatch({
        target: chip.project,
        slug: row.subject?.slug ?? row.uc.slug,
        featureName: row.uc.name,
        roundNo: row.subject?.roundNo ?? null,
      }),
    );
  }, [chip.project]);

  // The project has features, none of them reaches a context. Saying "0" here
  // would report an unscanned link layer as a measured absence.
  if (count === 0 && chip.featuresUnlinked) {
    return (
      <Tooltip content={interpolate(t.council_not_scanned_tooltip, { count: chip.featureTotal })}>
        <span className="inline-flex items-center gap-1 typo-caption text-foreground">
          <Layers className="w-3 h-3" />
          {t.council_not_scanned}
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip content={interpolate(t.council_chip_tooltip, { count })}>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="context-feature-chip"
          // The row behind is clickable and the popover is portalled, so this
          // press must reach neither: stopping it here is also what keeps the
          // shared outside-press dismissal from closing what it just opened.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 tabular-nums typo-caption text-sky-300 rounded-interactive hover:underline underline-offset-2 focus-ring"
        >
          <Layers className="w-3 h-3" />
          {count}
        </button>
      </Tooltip>

      {open && (
        <FeaturePopover
          triggerRef={triggerRef}
          contextName={contextName}
          useCases={useCases}
          chip={chip}
          t={t}
          onClose={close}
          onDispatch={dispatch}
        />
      )}

      {request && (
        <DispatchChooserModal request={request} onClose={() => setRequest(null)} />
      )}
    </>
  );
}

