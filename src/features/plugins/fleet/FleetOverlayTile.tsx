import { Trash2, BarChart3, Terminal as TerminalIcon } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetTerminalPane } from './FleetTerminalPane';
import { FleetSessionInsights } from './sub_grid/FleetSessionInsights';
import { FleetStatusDots } from './FleetStatusDots';
import { FleetTileAthenaBar } from './FleetTileAthenaBar';
import { sessionAttention, attentionClass, type FleetTileApproval } from './fleetAttention';

interface Props {
  session: FleetSession;
  isActive: boolean;
  /** Show the transcript-insights view instead of the live terminal. */
  showInsights: boolean;
  onToggleInsight: (id: string) => void;
  onSelect: (id: string) => void;
  /** Kill the session's process (removes the tile from the live grid). */
  onKill: (id: string) => void;
  /** Companion approvals already filtered for this session. */
  approvals: FleetTileApproval[];
  asking: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAsk: (session: FleetSession) => void;
}

/** One tile in the fullscreen terminal grid: a header (status dots, name,
 *  Terminal/Insights toggle, Kill), the live terminal or insights panel, and
 *  the Athena copilot bar. Extracted from FleetTerminalOverlay to keep both
 *  files lean. */
export function FleetOverlayTile({
  session: s, isActive, showInsights, onToggleInsight, onSelect, onKill,
  approvals, asking, onApprove, onReject, onAsk,
}: Props) {
  const { t } = useTranslation();
  // Attention border wins over the base/active border when set.
  const attn = attentionClass(sessionAttention(s));
  const borderCls = attn || (isActive ? 'border-primary/50' : 'border-primary/10 hover:border-primary/25');

  return (
    <div
      data-testid={`fleet-overlay-tile-${s.id}`}
      onMouseDown={() => onSelect(s.id)}
      className={`flex flex-col min-h-0 rounded-modal overflow-hidden border bg-[#0a0a0c] transition-colors ${borderCls}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-primary/10 bg-secondary/20 shrink-0">
        <FleetStatusDots state={s.state} reason={s.stateReason} />
        <span className="typo-caption truncate flex-1 min-w-0 text-foreground">{s.name ?? s.projectLabel}</span>
        <button
          type="button"
          data-testid={`fleet-tile-view-${s.id}`}
          aria-pressed={showInsights}
          aria-label={showInsights ? t.plugins.fleet.view_terminal : t.plugins.fleet.view_insights}
          title={showInsights ? t.plugins.fleet.view_terminal : t.plugins.fleet.view_insights}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onToggleInsight(s.id)}
          className="shrink-0 p-0.5 rounded text-foreground hover:bg-secondary/50 transition-colors"
        >
          {showInsights ? <TerminalIcon className="w-3 h-3" /> : <BarChart3 className="w-3 h-3" />}
        </button>
        <button
          type="button"
          data-testid={`fleet-tile-kill-${s.id}`}
          aria-label={t.plugins.fleet.kill_session}
          title={t.plugins.fleet.kill_session}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onKill(s.id)}
          className="shrink-0 p-0.5 rounded text-foreground hover:bg-red-400/20 hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {showInsights ? (
          <FleetSessionInsights claudeSessionId={s.claudeSessionId} />
        ) : (
          <FleetTerminalPane sessionId={s.id} autoFocus={false} />
        )}
      </div>
      <FleetTileAthenaBar
        session={s}
        approvals={approvals}
        asking={asking}
        onApprove={onApprove}
        onReject={onReject}
        onAsk={onAsk}
      />
    </div>
  );
}
