// Link editor popover — appears after connecting two projects (and on label
// click later): custom label, full/dashed style, colour from the short
// palette, delete. Commits live; Enter or Done closes.
import { Check, Trash2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { LINK_PALETTE } from './links';
import { mix } from './ink';
import type { UserLink } from './types';

export function LinkEditor({ link, x, y, onChange, onDelete, onClose }: {
  link: UserLink;
  /** Screen-space anchor (link midpoint projected). */
  x: number;
  y: number;
  onChange: (patch: Partial<UserLink>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const styleBtn = (dashed: boolean, label: string) => (
    <button
      type="button"
      onClick={() => onChange({ dashed })}
      aria-pressed={link.dashed === dashed}
      className={`px-2 py-1 typo-caption rounded-interactive transition-colors focus-ring ${
        link.dashed === dashed ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/60 hover:text-foreground hover:bg-primary/5'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={dashed ? '5 4' : undefined} strokeLinecap="round" />
        </svg>
        {label}
      </span>
    </button>
  );

  return (
    <div
      className="absolute z-30 w-[264px] p-2.5 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-3 space-y-2"
      style={{ left: Math.max(8, x - 132), top: Math.max(8, y - 130) }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-link-editor"
    >
      <input
        autoFocus
        value={link.label}
        placeholder={t.mastermind.link_placeholder}
        onChange={(e) => onChange({ label: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') onClose(); }}
        className="w-full px-2.5 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40"
        data-testid="mm-link-label-input"
      />
      <div className="flex items-center gap-1">{styleBtn(false, t.mastermind.link_full)}{styleBtn(true, t.mastermind.link_dashed)}</div>
      <div className="flex items-center gap-1.5">
        {LINK_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange({ color: c })}
            aria-pressed={link.color === c}
            aria-label={`Colour ${c}`}
            className="w-6 h-6 rounded-full border-2 transition-transform focus-ring"
            style={{ background: c, borderColor: link.color === c ? 'var(--foreground)' : mix(c, 40) }}
          />
        ))}
        <button
          type="button"
          onClick={onDelete}
          aria-label={t.mastermind.link_remove}
          className="ml-auto p-1.5 rounded-interactive text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors focus-ring"
          data-testid="mm-link-delete"
        >
          <Trash2 className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.done}
          className="p-1.5 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-link-done"
        >
          <Check className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
