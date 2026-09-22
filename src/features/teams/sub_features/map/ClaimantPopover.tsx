/* eslint-disable custom/enforce-base-modal --
 * An anchored popover over one map square, not a centered modal. A BaseModal
 * backdrop would blank the plot the square is read against, its focus trap
 * would fight the grid beneath, and its centered layout would break the
 * square-to-list connection this surface exists to make. role="dialog" plus a
 * translated aria-label give it the right semantics; dismissal and focus come
 * from the shared useClickOutside and the restore effect below. */
// Which feature did you mean? The panel behind a context square that several
// features claim.
//
// Follows `docs/concepts/golden-paths/anchored-popover.md`: portalled to the
// body so the plot's own scroll container is not its containing block,
// positioned by the shared `useAnchoredPortalPosition` (which reanchors on
// scroll and resize), dismissed by the shared `useClickOutside` (outside press
// AND Escape), announced as a dialog with a translated name, and returning
// focus on close.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';

const PANEL_WIDTH = 280;

export interface ClaimantPopoverProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  features: BoardFeature[];
  title: string;
  onPick: (featureId: string) => void;
  onClose: () => void;
}

export function ClaimantPopover({ triggerRef, features, title, onPick, onClose }: ClaimantPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPortalPosition(triggerRef, true, { flip: true, maxMenuHeight: 260, gap: 6 });
  useClickOutside(panelRef, true, onClose);

  useEffect(() => {
    const trigger = triggerRef.current;
    return () => trigger?.focus();
  }, [triggerRef]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      data-testid="features-claimant-popover"
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: Math.max(8, Math.min(pos?.left ?? 0, window.innerWidth - PANEL_WIDTH - 8)),
        width: PANEL_WIDTH,
        transform: pos?.flipUp ? 'translateY(-100%)' : undefined,
        // Hidden until the first measurement lands, so the panel never paints
        // at 0,0 and jumps.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-50 rounded-modal border border-border bg-background p-2 shadow-elevation-3"
    >
      <p className="px-1 pb-1 typo-caption">{title}</p>
      <ul className="flex flex-col">
        {features.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick(f.id)}
              className="w-full truncate rounded-interactive px-2 py-1.5 text-left typo-body text-foreground hover:bg-secondary/60 focus-ring"
            >
              {f.name}
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
