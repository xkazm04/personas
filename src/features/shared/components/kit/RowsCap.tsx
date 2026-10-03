import { Children, useState, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RowList, type RowColumn } from './RowColumns';
import { KitButton } from './Toolbar';

/**
 * The capped list behind `Rows cap` (grow-3): the first `cap` rows, then a "Show all N" control
 * under the last row that expands the list IN PLACE (the page scrolls, never the list) and
 * collapses it again; a polite status says how many rows show now. Not exported: reach it
 * through `<Rows cap>`.
 */
export function CappedRows({ cap, children, pager, label, columns, nameHead, nameWidth }: {
  cap: number;
  children: ReactNode;
  pager?: ReactNode;
  label?: string;
  /** The column set the list declared (grow-4): a capped list keeps its columns and its head. */
  columns?: readonly RowColumn[];
  nameHead?: ReactNode;
  /** The name track the list declared (home-3): a capped list keeps it too. */
  nameWidth?: string;
}) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const all = Children.toArray(children);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setSaid(next ? tx(t.shared.rows_showing_all, { count: all.length }) : tx(t.shared.rows_showing_first, { count: cap }));
  };
  const nav = (
    <>
      <KitButton quiet expanded={open} onClick={toggle}>
        {open ? t.shared.rows_show_fewer : tx(t.shared.rows_show_all, { count: all.length })}
      </KitButton>
      {pager}
      <span className="sr-only" role="status">{said}</span>
    </>
  );
  const rows = open ? all : all.slice(0, cap);
  if (columns) return <RowList columns={columns} nameHead={nameHead} nameWidth={nameWidth} label={label} pager={nav}>{rows}</RowList>;
  return (
    <>
      <div className="k-rows">{rows}</div>
      <nav className="k-pager" aria-label={label}>{nav}</nav>
    </>
  );
}
