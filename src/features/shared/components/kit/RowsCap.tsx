import { Children, useState, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { KitButton } from './Toolbar';

/**
 * The capped list behind `Rows cap` (grow-3): the first `cap` rows, then a "Show all N" control
 * under the last row that expands the list IN PLACE (the page scrolls, never the list) and
 * collapses it again; a polite status says how many rows show now. Not exported: reach it
 * through `<Rows cap>`.
 */
export function CappedRows({ cap, children, pager, label }: { cap: number; children: ReactNode; pager?: ReactNode; label?: string }) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const all = Children.toArray(children);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setSaid(next ? tx(t.shared.rows_showing_all, { count: all.length }) : tx(t.shared.rows_showing_first, { count: cap }));
  };
  return (
    <>
      <div className="k-rows">{open ? all : all.slice(0, cap)}</div>
      <nav className="k-pager" aria-label={label}>
        <KitButton quiet expanded={open} onClick={toggle}>
          {open ? t.shared.rows_show_fewer : tx(t.shared.rows_show_all, { count: all.length })}
        </KitButton>
        {pager}
        <span className="sr-only" role="status">{said}</span>
      </nav>
    </>
  );
}
