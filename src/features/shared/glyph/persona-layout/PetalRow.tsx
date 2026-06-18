import type { ReactNode } from 'react';
import { DIM_META } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/** Status-pip colour per petal state. */
export const STATE_PIP: Record<PetalState, string> = {
  resolved: 'bg-status-success',
  filling: 'bg-primary',
  pending: 'bg-status-warning',
  error: 'bg-status-error',
  idle: 'bg-foreground/25',
};

/**
 * One row in a glyph-dimension quick-action rail: the symbolic petal icon
 * (state by colour/fill + a status pip) plus a fixed-width info box that
 * surfaces the petal's resolved value at a glance. The whole row is clickable
 * and routes to the petal's action; the descriptive words live in the hover
 * tooltip.
 *
 * Shared by the template-adoption layout (`PersonaLayoutAdoption`) and the
 * agent Use Cases layout (`UseCaseLeftPanel`) — each caller supplies the
 * per-dim `info` node + `tooltip`/`ariaLabel` from its own data model, so this
 * component carries no adoption- or view-specific coupling.
 */
export function PetalRow({
  dim,
  state,
  active,
  tooltip,
  ariaLabel,
  info,
  onSelect,
}: {
  dim: GlyphDimension;
  state: PetalState;
  active: boolean;
  tooltip?: string;
  ariaLabel?: string;
  info: ReactNode;
  onSelect: (d: GlyphDimension) => void;
}) {
  const meta = DIM_META[dim];
  const Icon = meta.icon;
  const lit = state === 'resolved' || state === 'filling';

  return (
    <Tooltip content={tooltip ?? meta.labelKey} placement="right">
      <button
        type="button"
        onClick={() => onSelect(dim)}
        aria-label={ariaLabel ?? dim}
        className={`group flex w-full items-center gap-2 rounded-card transition-all cursor-pointer ${
          active ? 'ring-2 ring-primary/40' : ''
        }`}
      >
        <span
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-card border transition-all ${
            active
              ? 'border-primary/70'
              : state === 'pending'
                ? 'border-status-warning/55'
                : lit
                  ? 'border-card-border/40'
                  : 'border-card-border/25'
          }`}
          style={lit ? { backgroundColor: `${meta.color}1c` } : undefined}
        >
          <Icon
            className={`h-5 w-5 transition-opacity ${lit ? '' : 'opacity-40'}`}
            style={lit ? { color: meta.color } : undefined}
          />
          <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card-bg ${STATE_PIP[state]}`} />
        </span>
        {/* Fixed-width info box — flex-1 fills the rail so every row's box
            aligns. Bordered only when it carries content. */}
        <span
          className={`flex h-11 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-card px-2 ${
            info ? 'border border-card-border/30 bg-secondary/20' : 'border border-transparent'
          }`}
        >
          {info}
        </span>
      </button>
    </Tooltip>
  );
}
