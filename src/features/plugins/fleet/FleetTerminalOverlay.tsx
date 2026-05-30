import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PendingApproval } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { FleetTerminalPane } from './FleetTerminalPane';
import { FleetStatusDots } from './FleetStatusDots';
import { FleetTileAthenaBar } from './FleetTileAthenaBar';
import { setFleetFontOverride } from './fleetTerminalManager';
import { sessionAttention, attentionClass, approvalsForSession } from './fleetAttention';

interface Props {
  open: boolean;
  /** Live (non-exited) sessions to tile, in display order. */
  sessions: FleetSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  /** Minimize — return to the single-pane view. */
  onClose: () => void;
  /** Athena copilot wiring (suggestions surfaced on each tile). */
  approvals: PendingApproval[];
  /** Session ids with an in-flight "Ask Athena" turn. */
  askingSessionIds: Set<string>;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onAskAthena: (session: FleetSession) => void;
}

/**
 * Column count for `n` sessions, capped at 4 → square grids 1×1 … 4×4.
 * 1→1, 2-4→2, 5-9→3, 10-16→4 (and 4 thereafter, the grid scrolls).
 */
function gridDim(n: number): number {
  if (n <= 1) return 1;
  return Math.min(4, Math.ceil(Math.sqrt(n)));
}

/**
 * Density-scaled terminal font (px). Smaller as the grid densifies so more
 * columns/rows fit per tile, with a 12px floor for legibility (VS Code's
 * terminal default is 14px for reference). The page chrome is unaffected.
 */
function densityFont(dim: number): number {
  switch (dim) {
    case 1:
      return 15;
    case 2:
      return 14;
    case 3:
      return 13;
    default:
      return 12;
  }
}

/**
 * Fullscreen, app-wide terminal grid. Portaled to `document.body` so it sits
 * above the (transform-using) framer-motion layout ancestors — a plain
 * `fixed inset-0` nested in the page would be positioned relative to a
 * transformed ancestor, not the viewport.
 *
 * Every tile attaches a durable managed terminal (the same instances the
 * single pane uses), so opening/closing the overlay is lossless. The single
 * pane is unmounted by the parent while this is open so the two don't contend
 * for the same terminal's holder element.
 */
export function FleetTerminalOverlay({
  open,
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  approvals,
  askingSessionIds,
  onApprove,
  onReject,
  onAskAthena,
}: Props) {
  const { t, tx } = useTranslation();
  const setBackInterceptor = useSystemStore((s) => s.setBackInterceptor);
  const dim = useMemo(() => gridDim(sessions.length), [sessions.length]);

  // Apply the density font override while open; clear it on close/unmount.
  useEffect(() => {
    if (!open) return;
    setFleetFontOverride(densityFont(dim));
    return () => setFleetFontOverride(null);
  }, [open, dim]);

  // Route the global titlebar Back button (and Escape) to minimize, instead of
  // navigating the underlying page out from under the overlay.
  useEffect(() => {
    if (!open) return;
    setBackInterceptor(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      setBackInterceptor(null);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, setBackInterceptor]);

  if (!open) return null;

  const count = sessions.length;
  const countLabel =
    count === 1
      ? tx(t.plugins.fleet.sessions_one, { count })
      : tx(t.plugins.fleet.sessions_other, { count });

  return createPortal(
    // Fullscreen terminal grid — a working surface (labeled region), not a
    // centered dialog, so it doesn't use BaseModal. It starts below the 48px
    // titlebar (`top-12`) rather than `inset-0` so the always-on-top titlebar
    // (z-9999) — including its global Back button and the window controls —
    // stays visible and usable above it. Dismissal: titlebar/overlay Back or
    // Escape.
    <div
      className="fixed left-0 right-0 bottom-0 top-12 z-[200] flex flex-col bg-background"
      data-testid="fleet-terminal-overlay"
      role="region"
      aria-label={t.plugins.fleet.grid_overlay_aria}
    >
      {/* Header — back button (minimize) + count. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/20 shrink-0">
        <button
          type="button"
          data-testid="fleet-overlay-back"
          onClick={onClose}
          className="flex items-center gap-1 rounded-interactive border border-primary/15 px-2 py-1 text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <ChevronLeft className="w-4 h-4" />
          {t.plugins.fleet.grid_back}
        </button>
        <LayoutGrid className="w-4 h-4 text-primary ml-1" aria-hidden="true" />
        <span className="typo-caption text-foreground">{countLabel}</span>
      </div>

      {/* Grid — square columns capped at 4; rows auto-fill, scroll past 4×4. */}
      <div
        data-testid="fleet-overlay-grid"
        className="flex-1 min-h-0 grid gap-1.5 p-1.5 overflow-y-auto"
        style={{
          gridTemplateColumns: `repeat(${dim}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(160px, 1fr)',
        }}
      >
        {sessions.map((s) => {
          const isActive = s.id === activeSessionId;
          // Attention border wins over the base/active border when set.
          const attn = attentionClass(sessionAttention(s));
          const borderCls = attn || (isActive ? 'border-primary/50' : 'border-primary/10 hover:border-primary/25');
          const tileApprovals = approvalsForSession(approvals, s.id);
          return (
            <div
              key={s.id}
              data-testid={`fleet-overlay-tile-${s.id}`}
              onMouseDown={() => onSelect(s.id)}
              className={`flex flex-col min-h-0 rounded-modal overflow-hidden border bg-[#0a0a0c] transition-colors ${borderCls}`}
            >
              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-primary/10 bg-secondary/20 shrink-0">
                <FleetStatusDots state={s.state} reason={s.stateReason} />
                <span className="typo-caption truncate flex-1 min-w-0 text-foreground">
                  {s.name ?? s.projectLabel}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <FleetTerminalPane sessionId={s.id} autoFocus={false} />
              </div>
              <FleetTileAthenaBar
                session={s}
                approvals={tileApprovals}
                asking={askingSessionIds.has(s.id)}
                onApprove={onApprove}
                onReject={onReject}
                onAsk={onAskAthena}
              />
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
