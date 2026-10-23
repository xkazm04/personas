import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useSheet } from '../../controller/SheetContext';
import type { Change } from '../../model/changes';
import { Press } from '../Press';
import { ChangesList } from './ChangesList';

/**
 * "N changed" (header, beside the page switch): what the store moved since the operator last looked, only while there
 * is something. Pressing it opens the list (newest first) and clears the chip: the entries are marked seen the moment
 * the list opens, and an entry that arrives while it is open joins it. Pressing an entry goes to what it names (a
 * proposal -> selected on the plan, a reading -> its feature, a run -> the Agents flyout). The list is portalled into
 * the header so the title line's overflow clip cannot cut it; Esc closes it first (the shared dismissal claims the
 * key, as the project switcher does), and the sheet's own Esc ladder is not reached.
 */
export function ChangesChip() {
  const s = useSheet();
  const { B, tx } = s.text;
  const { pending, markSeen } = s.changes;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<readonly Change[]>([]);
  const [at, setAt] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);

  // opened: take what is pending (now, and whatever arrives while it is open) into the list and mark it seen
  useEffect(() => {
    if (!open || !pending.length) return;
    setShown((old) => [...pending, ...old]);
    markSeen();
  }, [open, pending, markSeen]);

  const items = () => Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (refocus = true) => { setOpen(false); setShown([]); if (refocus) trigger.current?.focus(); };
  useClickOutside([pop, trigger], open, () => close(false), { claimEscape: true });

  const toggle = () => {
    if (open) { close(false); return; }
    const hd = trigger.current?.closest('.bp-hd')?.getBoundingClientRect(), t = trigger.current?.getBoundingClientRect();
    if (hd && t) setAt({ left: Math.max(0, t.left - hd.left), top: t.bottom - hd.top + 6 });
    setShown([]);
    setOpen(true);
    requestAnimationFrame(() => items()[0]?.focus());
  };

  const go = (c: Change) => {
    close(false);
    if (c.kind === 'run') { s.dispatch({ type: 'flyout', id: 'agents' }); return; }
    if (c.kind === 'readings') { s.nav.flyToFeature(c.fid); return; }
    const p = s.work.byId.get(c.id);
    if (p) s.nav.select(p, true);
  };

  const onKey = (e: KeyboardEvent) => {
    const els = items(), i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { close(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }
    const j = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    els[j]?.focus();
  };

  const count = open ? shown.length : pending.length;
  if (!open && !count) return null;
  const host = trigger.current?.closest('.bp-hd') ?? null;
  return (
    <>
      <Press
        ref={trigger}
        tone="bp-chg"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'bp-chg-list' : undefined}
        aria-label={tx(B.changes_chip_label, { count })}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        data-testid="blueprint-changes-chip"
      >
        <i aria-hidden="true" />{tx(B.changes_chip, { count })}
      </Press>
      {open && host && createPortal(<ChangesList ref={pop} id="bp-chg-list" entries={shown} onGo={go} style={at} onKeyDown={onKey} />, host)}
    </>
  );
}
