import type { ReactNode } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSheet } from '../../controller/SheetContext';
import { Press } from '../Press';

const WIDTH = { md: 'max-w-xl', lg: 'max-w-3xl' } as const;

interface Props {
  titleId: string;
  title: ReactNode;
  /** A 12 px mono kicker under the title. */
  sub?: ReactNode;
  width?: keyof typeof WIDTH;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The sheet's dialog frame in bp's language (bp #callout / #dcard / .pj-dlg): the shared BaseModal owns the stack, the
 * backdrop, the focus and the portal; the panel itself carries `.bp-scope`, so bp's palette resolves inside it even
 * though it is portalled out of the sheet. A --bp-card-hi panel, square, a 3 px lens rule on top, the title in
 * condensed caps, a mono kicker, an Esc key-box to close, and an optional mono footer of keys.
 */
export function BpDialog({ titleId, title, sub, width = 'md', footer, onClose, children }: Props) {
  const { B } = useSheet().text;
  return (
    <BaseModal isOpen onClose={onClose} titleId={titleId} portal maxWidthClass={WIDTH[width]} panelClassName="bp-scope bp-dlg" staggerChildren={false}>
      <header className="bp-dlg-h">
        <h2 id={titleId}>{title}</h2>
        {sub && <p>{sub}</p>}
        <Press tone="bp-x" onClick={onClose} aria-label={B.dlg_close}>{B.dlg_esc}</Press>
      </header>
      <div className="bp-dlg-b">{children}</div>
      {footer && <div className="bp-dlg-f">{footer}</div>}
    </BaseModal>
  );
}
