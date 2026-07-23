// R21 — the cockpit bench's hierarchy breadcrumb, migrated into the Factory as
// the bench retires: Projects ▸ project, where the leaf carries the project's
// attention dot and doubles as a SIBLING SWITCHER (anchored portal menu) — the
// breadcrumb is a navigation manipulator, not just a location label.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronsUpDown } from 'lucide-react';

import { anchorTip } from './passport/passportInk';

export interface FactoryCrumbSibling {
  id: string;
  label: string;
  /** Short right-aligned note in the switcher (off-track count, "healthy"…). */
  note?: string;
  hue: string;
}

export function FactoryBreadcrumb({ root, onRoot, leaf }: {
  root: string;
  onRoot: () => void;
  leaf: {
    label: string;
    hue: string;
    siblings: FactoryCrumbSibling[];
    onSelect: (id: string) => void;
  };
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);

  return (
    <nav aria-label="Factory hierarchy" data-testid="factory-breadcrumb" className="flex items-center gap-1 min-w-0 mb-2">
      <button
        type="button"
        onClick={onRoot}
        className="typo-caption text-foreground/50 hover:text-foreground transition-colors focus-ring rounded-interactive px-1 -mx-1"
      >
        {root}
      </button>
      <ChevronRight className="w-3 h-3 text-foreground/25 shrink-0" aria-hidden />
      <button
        type="button"
        data-testid="factory-crumb-leaf"
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
        className="inline-flex items-center gap-1.5 min-w-0 px-1.5 py-0.5 rounded-input border border-transparent hover:border-foreground/15 hover:bg-foreground/[0.04] transition-colors focus-ring"
        title="Switch project"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: leaf.hue, boxShadow: `0 0 5px ${leaf.hue}88` }} />
        <span className="typo-caption font-semibold text-foreground truncate">{leaf.label}</span>
        <ChevronsUpDown className="w-3 h-3 text-foreground/40 shrink-0" aria-hidden />
      </button>
      {menu && createPortal(
        <div
          data-testid="factory-crumb-switcher"
          className="fixed z-50 w-[240px] rounded-modal overflow-hidden py-1"
          style={{
            ...anchorTip(menu, 240, 40 + leaf.siblings.length * 34),
            background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
            border: '1px solid rgba(148,163,184,.22)',
            boxShadow: '0 16px 40px rgba(0,0,0,.45)',
          }}
          onMouseLeave={() => setMenu(null)}
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-foreground/40">{root}</div>
          {leaf.siblings.map((s) => {
            const current = s.label === leaf.label;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setMenu(null); if (!current) leaf.onSelect(s.id); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.05] ${current ? 'bg-foreground/[0.03]' : ''}`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.hue, boxShadow: `0 0 4px ${s.hue}77` }} />
                <span className={`typo-caption truncate ${current ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>{s.label}</span>
                {s.note && <span className="typo-label text-foreground/40 ml-auto shrink-0">{s.note}</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </nav>
  );
}
