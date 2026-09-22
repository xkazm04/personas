/* eslint-disable custom/enforce-base-modal --
 * This is a popover anchored to a ledger row's chip, not a centered modal. A
 * BaseModal backdrop would blank the board the list is read against, its focus
 * trap would fight the row beneath, and its centered layout would break the
 * chip-to-list connection the surface exists to make. role="dialog" plus a
 * translated aria-label give it the right semantics; dismissal and focus come
 * from the shared useClickOutside and the restore effect below. */
// The panel behind the ledger's feature chip (trigger: `FeatureChip.tsx`).
//
// An anchored surface the user acts inside, so it follows
// `docs/concepts/golden-paths/anchored-popover.md`: portalled out of the
// `content-visibility` group band that would otherwise be its containing
// block, positioned by the shared `useAnchoredPortalPosition` (which reanchors
// on scroll and resize), dismissed by the shared `useClickOutside` (outside
// press AND Escape, never a hand-wired document listener), announced as a
// dialog with a translated name, and returning focus on close.
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import { interpolate } from '@/i18n/useTranslation';

import type { TDevTools } from './contextLedgerShared';
import { councilFleetKey } from './councilDispatch';
import { FeaturePopoverRow, type FeatureRowModel } from './FeaturePopoverRow';
import type { FeatureChipContext } from './featureChipContext';
import { useCouncilStates } from './useCouncilStates';

const PANEL_WIDTH = 460;
const VIEWPORT_MARGIN = 8;

/** How many context GROUPS a feature reaches. Derived from the contexts it is
 *  linked to, so a feature the board has never heard of yields 0 because it
 *  spans nothing, not because a lookup missed. */
export function groupSpan(uc: DevUseCase, groupIdByContext: Map<string, string>): number {
  const gids = new Set<string>();
  for (const cid of uc.context_ids) {
    const gid = groupIdByContext.get(cid);
    if (gid !== undefined) gids.add(gid);
  }
  return gids.size;
}

/** Name-ascending, locale-aware. The chip and the popover share one predicate:
 *  the rows listed are exactly the features the count counted. */
export function sortFeatures(useCases: DevUseCase[]): DevUseCase[] {
  return [...useCases].sort((a, b) => a.name.localeCompare(b.name));
}

export function FeaturePopover({
  triggerRef,
  contextName,
  useCases,
  chip,
  t,
  onClose,
  onDispatch,
  onOpenCouncil,
}: {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contextName: string;
  useCases: DevUseCase[];
  chip: FeatureChipContext;
  t: TDevTools;
  onClose: () => void;
  onDispatch: (row: FeatureRowModel) => void;
  /** Leave for the Council page's gate, focused on one subject. */
  onOpenCouncil: (subjectId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const project = chip.project;
  const { byUseCaseId, runningKeys, loading, error, refresh } = useCouncilStates(
    project?.projectId ?? null,
    project?.rootPath ?? null,
  );

  const pos = useAnchoredPortalPosition(triggerRef, true, { flip: true, maxMenuHeight: 320, gap: 6 });
  useClickOutside(panelRef, true, onClose);

  // Focus enters the panel on open and goes back to whatever had it on close —
  // the clause `anchored-popover.md` records as unimplemented at 0 of 63 sites.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const rows: FeatureRowModel[] = useMemo(
    () =>
      sortFeatures(useCases).map((uc) => {
        const subject = byUseCaseId.get(uc.id) ?? null;
        const slug = subject?.slug ?? uc.slug;
        return {
          uc,
          subject,
          running: project ? runningKeys.has(councilFleetKey(project.projectId, slug)) : false,
          groupCount: groupSpan(uc, chip.groupIdByContext),
        };
      }),
    [useCases, byUseCaseId, runningKeys, project, chip.groupIdByContext],
  );

  const title = interpolate(t.council_popover_title, { context: contextName });
  const left = pos
    ? Math.max(VIEWPORT_MARGIN, Math.min(pos.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN))
    : 0;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-testid="feature-popover"
      style={{
        top: pos?.top ?? 0,
        left,
        width: PANEL_WIDTH,
        transform: pos?.flipUp ? 'translateY(-100%)' : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden focus:outline-none"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/15">
        <span className="typo-caption text-foreground truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.council_close}
          className="p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* A read that FAILED says so. The features below are still real; only
          their review state is unknown, and the banner says which. */}
      {error && (
        <p className="px-3 py-2 typo-caption text-status-warning border-b border-primary/10">
          {t.council_read_failed}
        </p>
      )}

      <ul className="max-h-80 overflow-auto">
        {rows.map((row) => (
          <FeaturePopoverRow
            key={row.uc.id}
            row={row}
            t={t}
            onDispatch={onDispatch}
            onOpenCouncil={onOpenCouncil}
            onTierChanged={refresh}
          />
        ))}
      </ul>

      {/* Ghost UNDER the chrome while the first read is in flight — never a
          spinner, never a branch that replaces the list. */}
      {loading && (
        <div className="px-3 py-2 space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <span key={i} className="block h-2.5 w-40 rounded bg-primary/[0.06] animate-fade-in" />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
