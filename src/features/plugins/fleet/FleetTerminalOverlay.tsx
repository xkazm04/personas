import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, LayoutGrid, BookOpen, Play } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PendingApproval } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { FleetOverlayTile } from './FleetOverlayTile';
import { setFleetFontOverride } from './fleetTerminalManager';
import { approvalsForSession } from './fleetAttention';
import { gridDim, densityFont } from './fleetGridLayout';

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
  /** Open the shared skill-library drawer (applies to the focused tile). */
  onOpenSkills: () => void;
  /** Spawn a new session in the active project. */
  onSpawn: () => void;
  /** Whether a spawn is currently possible (project selected, not spawning). */
  canSpawn: boolean;
  /** Kill a session's process by id. */
  onKill: (id: string) => void;
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
  onOpenSkills,
  onSpawn,
  canSpawn,
  onKill,
}: Props) {
  const { t, tx } = useTranslation();
  const setBackInterceptor = useSystemStore((s) => s.setBackInterceptor);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const dim = useMemo(() => gridDim(sessions.length), [sessions.length]);

  // Flag the grid as open so the Athena orb floats above this overlay (it's
  // otherwise z-50, behind the z-[200] overlay) — she stays visible/reactable
  // while you orchestrate in the grid.
  useEffect(() => {
    setGridOpen(open);
    return () => setGridOpen(false);
  }, [open, setGridOpen]);

  // Per-tile Terminal/Insights view (P2.1 in the grid). Membership = showing
  // Insights; default (absent) = the live terminal.
  const [insightTiles, setInsightTiles] = useState<Set<string>>(new Set());
  const toggleInsight = useCallback((id: string) => {
    setInsightTiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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
      className="fleet-typescale fixed left-0 right-0 bottom-0 top-12 z-[200] flex flex-col bg-background"
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
        <button
          type="button"
          data-testid="fleet-overlay-spawn"
          onClick={onSpawn}
          disabled={!canSpawn}
          title={t.plugins.fleet.new_session}
          className="ml-auto flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <Play className="w-3.5 h-3.5" />
          {t.plugins.fleet.new_session}
        </button>
        <button
          type="button"
          data-testid="fleet-overlay-skills"
          onClick={onOpenSkills}
          title={t.plugins.fleet.skills_drawer_title}
          className="flex items-center gap-1.5 rounded-interactive border border-primary/15 px-2 py-1 text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <BookOpen className="w-3.5 h-3.5" />
          {t.plugins.fleet.skills_button}
        </button>
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
        {sessions.map((s) => (
          <FleetOverlayTile
            key={s.id}
            session={s}
            isActive={s.id === activeSessionId}
            showInsights={insightTiles.has(s.id)}
            onToggleInsight={toggleInsight}
            onSelect={onSelect}
            onKill={onKill}
            approvals={approvalsForSession(approvals, s.id)}
            asking={askingSessionIds.has(s.id)}
            onApprove={onApprove}
            onReject={onReject}
            onAsk={onAskAthena}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
