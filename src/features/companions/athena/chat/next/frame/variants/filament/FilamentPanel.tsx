/**
 * Filament · queue segment (slim) — the right panel is now ONLY the ambient
 * line (contest B/1's `.q-slim`): a count, a bead per waiting item, a tick
 * per running/failed process. Replaces `../c/BinderPanel.tsx`'s collection
 * binder; no ring, no filigree, no card edges (contest brief's hard
 * constraint). Clicking it, or `Alt+W`, opens the SAME combined queue +
 * projects + decision surface the contest drew as one spread
 * (`FilamentStage.tsx`, mounted centrally by `VariantFrame` — see that
 * file for the `.q-spread` side rail this slim line feeds).
 *
 * TODO(prototype, 2026-10-03): first in-app port of the contest winner.
 */

import { KIND_VAR } from '../../../tones';
import type { RightPanelProps } from '../../slots';
import { FILAMENT_COPY as F } from './copy';
import './filament.css';

export function FilamentPanel({ columns, waiting, onOpenWaiting }: RightPanelProps) {
  const beads = columns.flatMap((c) => c.decisions).slice(0, 9);
  const first = beads[0] ?? null;
  const procs = columns
    .flatMap((c) => c.processes)
    .filter((p) => p.state === 'running' || p.state === 'failed')
    .slice(0, 14);

  return (
    <div className="filament-frame h-full min-h-0 flex items-stretch pointer-events-auto">
      <button
        type="button"
        onClick={onOpenWaiting}
        className="q-slim focus-ring"
        aria-label={`${F.waiting(waiting)}${first ? `, first: ${first.title}` : ''}. ${F.openLine}, ${F.altW}`}
        data-testid="companion-filament-queue-slim"
      >
        <span className="q-count knock">
          <span className="typo-data num" style={{ color: waiting ? undefined : 'var(--muted-foreground)' }}>
            {waiting}
          </span>
          <span className="typo-label">{waiting === 1 ? 'waiting' : 'waiting'}</span>
          <span className="kbd typo-caption">{F.altW}</span>
        </span>
        {/* One bead per waiting item, in ITS OWN kind colour — the mock's whole
            ambient signal is which kinds are stacked up, not a count of amber
            dots. The first breathes. */}
        {beads.length > 0 && (
          <span className="q-beads" aria-hidden>
            {beads.map((d, i) => (
              <span key={d.id} className={`bead${i === 0 ? ' first' : ''}`} style={{ ['--c' as string]: KIND_VAR[d.kind] }} />
            ))}
          </span>
        )}
        {procs.length > 0 && (
          <span className="q-procs" aria-hidden>
            {procs.map((p) => (
              <i
                key={p.id}
                className={p.state === 'running' ? 'run' : ''}
                style={{ ['--c' as string]: p.state === 'failed' ? 'var(--status-error)' : 'var(--primary)' }}
              />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
