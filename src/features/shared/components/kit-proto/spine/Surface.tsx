import type { ReactNode, Ref } from 'react';
import { KitButton } from './Toolbar';
import { cx } from './types';

/**
 * The kit's root: carries the kit variables and the container the side pane measures. `compact`
 * puts the surface on the compact type tier, as the variant does for Fleet.
 */
export function KitHost({ compact, children, testId }: { compact?: boolean; children: ReactNode; testId?: string }) {
  return (
    <div className="k-host" data-type-density={compact ? 'compact' : undefined} data-testid={testId}>
      {children}
    </div>
  );
}

/** A surface: everything on it hangs from one vertical spine at --spine-x. */
export function Surface({ dense, children }: { dense?: boolean; children: ReactNode }) {
  return <div className={cx('k-surface', dense && 'k-surface--dense')}>{children}</div>;
}

/**
 * Work area plus a sticky side pane for the selection's detail. The pane shows only when the
 * surface has room (a container query), otherwise the detail opens in the Drawer.
 */
export function Split({ main, pane, paneLabel, paneRef }: {
  main: ReactNode;
  pane: ReactNode;
  paneLabel: string;
  paneRef?: Ref<HTMLElement>;
}) {
  return (
    <div className="k-split">
      {main}
      <aside ref={paneRef} className="k-pane" aria-label={paneLabel}>
        <Surface>{pane}</Surface>
      </aside>
    </div>
  );
}

/** The nested detail layer on a narrow surface; Esc (the caller's key handler) closes it. */
export function Drawer({ open, onClose, closeLabel, label, children }: {
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <aside className={cx('k-drawer', open && 'is-open')} aria-label={label} aria-hidden={!open} data-type-density="compact">
      <KitButton className="k-drawer__close" onClick={onClose} hint="Esc">{closeLabel}</KitButton>
      <div className="k-drawer__scroll">
        {open && <Surface>{children}</Surface>}
      </div>
    </aside>
  );
}
