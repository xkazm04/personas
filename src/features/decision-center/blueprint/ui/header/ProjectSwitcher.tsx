import { useRef, useState, type KeyboardEvent } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import type { BlueprintProductEntry, ReadinessLevel } from '../../source';
import { Press } from '../Press';
import { LevelIcon } from './LevelIcon';

const WORD = { missing: 'level_word_missing', 'map-only': 'level_word_map_only', measured: 'level_word_measured', full: 'level_word_full' } as const satisfies Record<ReadinessLevel, keyof BpText>;

/**
 * The header's project control (bp ProjectSwitcher.tsx): the open product's name with its readiness shape and a caret,
 * and a popover listing every lens-scan product with its readiness (a shape AND a word, never colour alone). Picking
 * a row hands its id to `actions.openProduct`; the host reopens the sheet there. A product that cannot be drawn
 * (missing) says why and does not switch. Without `data.products` the popover holds the open product alone.
 * bp's "Manage projects..." is not here: Personas registers products as dev_projects, and no surface for that is
 * reachable from the sheet without a new door.
 */
export function ProjectSwitcher() {
  const s = useSheet();
  const { B, tx } = s.text;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const curId = s.data.product.projectId;
  const list: BlueprintProductEntry[] = s.data.products ?? [];
  const cur = list.find((p) => p.projectId === curId);
  const rows = cur ? list : [{ projectId: curId, name: s.data.product.name, level: null, proposals: 0 } as const, ...list];

  const items = () => Array.from(pop.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const openMenu = (last = false) => {
    setOpen(true);
    requestAnimationFrame(() => {
      const els = items();
      (last ? els[els.length - 1] : els.find((e) => e.getAttribute('aria-checked') === 'true') ?? els[0])?.focus();
    });
  };
  const choose = (p: { projectId: string; level: ReadinessLevel | null }) => {
    if (p.projectId === curId) { close(); return; }
    if (p.level === 'missing') return;
    setOpen(false);
    s.actions.openProduct?.(p.projectId);
  };

  // an outside press or Esc closes it (the shared dismissal; Esc inside the menu is handled, and stopped, below)
  useClickOutside([pop, trigger], open, () => setOpen(false), { claimEscape: true });

  // the sheet's keymap listens on the window: every key the switcher uses stops here
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); openMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openMenu(true); }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const els = items(), i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }
    const j = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    els[j]?.focus();
  };

  const name = cur?.name ?? s.data.product.name;
  return (
    <div className="projsw" data-testid="blueprint-project-switcher">
      <Tooltip content={tx(B.project_switch, { name })} placement="bottom">
        <Press
          ref={trigger}
          tone="projsw-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'bp-projsw-menu' : undefined}
          aria-label={tx(B.project_switch, { name })}
          onClick={() => (open ? close(false) : openMenu())}
          onKeyDown={onTriggerKey}
        >
          {cur && <LevelIcon level={cur.level} />}
          <span className="nm">{name}</span>
          <svg className="car" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1 5 5 9 1" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </Press>
      </Tooltip>
      {open && (
        <div ref={pop} id="bp-projsw-menu" className="projsw-pop" role="menu" aria-label={B.projects} onKeyDown={onMenuKey} data-testid="blueprint-project-menu">
          <div className="projsw-h"><span>{B.projects}</span><span>{tx(B.projects_registered, { count: list.length })}</span></div>
          {rows.map((p) => {
            const on = p.projectId === curId, off = p.level === 'missing' && !on;
            return (
              <Press
                key={p.projectId}
                tone="projsw-it"
                role="menuitemradio"
                aria-checked={on}
                aria-disabled={off || undefined}
                tabIndex={-1}
                onClick={() => choose(p)}
                data-project={p.projectId}
              >
                <span className="nm">{p.name}{off && <span className="why">{B.level_tip_missing}</span>}</span>
                {p.level && <span className="lv"><LevelIcon level={p.level} />{B[WORD[p.level]]}</span>}
              </Press>
            );
          })}
          {list.length < 2 && <div className="projsw-none">{B.projects_none}</div>}
        </div>
      )}
    </div>
  );
}

