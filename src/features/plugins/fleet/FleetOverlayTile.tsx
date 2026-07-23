import { useEffect } from 'react';
import { Trash2, BarChart3, MoonStar, Terminal as TerminalIcon } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetTerminalPane } from './FleetTerminalPane';
import { focusTerminal } from './fleetTerminalManager';
import { FleetTileStatusBlock } from './FleetTileStatusBlock';
import { FleetSessionInsights } from './sub_grid/FleetSessionInsights';
import { FleetStatusDots } from './FleetStatusDots';
import { FleetTileAthenaBar } from './FleetTileAthenaBar';
import { sessionAttention, attentionClass, type FleetTileApproval } from './fleetAttention';

interface Props {
  session: FleetSession;
  /** Drives the highlighted border + which tile keyboard/skills target. */
  isActive: boolean;
  /** Whether this tile mounts a live (subscribed) terminal vs a status block.
   *  True for the focused tile and for any session that needs the operator
   *  (`needsLiveAttention`); everything else renders a cheap status block. */
  live: boolean;
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
  session: s, isActive, live, showInsights, onToggleInsight, onSelect, onKill,
  approvals, asking, onApprove, onReject, onAsk,
}: Props) {
  const { t } = useTranslation();
  // Attention border wins over the base/active border when set.
  const attn = attentionClass(sessionAttention(s));
  const borderCls = attn || (isActive ? 'border-primary/50' : 'border-primary/10 hover:border-primary/25');
  // Exited / hibernated tiles are in-place TOMBSTONES: they hold their grid
  // slot (so the layout never shifts) but have no PTY to attach — status block
  // only, and the trash control dismisses instead of kills.
  const tombstone = s.state === 'exited' || s.state === 'hibernated';
  const showsTerminal = live && !tombstone && s.mode !== 'headless' && !showInsights;

  // Selecting a tile must also FOCUS its terminal — clicking the frame used to
  // reveal the xterm but still demand a second click inside it before typing.
  // Parent effects run after the child pane's attach effect, so the terminal
  // is attached by the time this fires.
  useEffect(() => {
    if (isActive && showsTerminal) focusTerminal(s.id);
  }, [isActive, showsTerminal, s.id]);

  return (
    <div
      data-testid={`fleet-overlay-tile-${s.id}`}
      onMouseDown={() => onSelect(s.id)}
      className={`flex flex-col min-h-0 rounded-modal overflow-hidden border bg-[#0a0a0c] transition-colors ${borderCls}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-primary/10 bg-secondary/20 shrink-0">
        <FleetStatusDots state={s.state} reason={s.stateReason} />
        <span className="typo-caption truncate flex-1 min-w-0 text-foreground">{s.name ?? s.title ?? s.projectLabel}</span>
        {s.dozing && (
          <span
            data-testid={`fleet-tile-dozing-${s.id}`}
            className="shrink-0 inline-flex"
            title={t.plugins.fleet.doze_tooltip}
            aria-label={t.plugins.fleet.doze_tooltip}
          >
            <MoonStar className="w-3 h-3 text-indigo-300" aria-hidden="true" />
          </span>
        )}
        {s.mode === 'headless' && (
          <span
            className="shrink-0 rounded-card border border-primary/15 bg-secondary/40 px-1.5 py-0.5 text-[10px] text-foreground opacity-80"
            title={t.plugins.fleet.headless_no_terminal}
          >
            {t.plugins.fleet.headless_badge}
          </span>
        )}
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
          aria-label={tombstone ? t.plugins.fleet.dismiss_session : t.plugins.fleet.kill_session}
          title={tombstone ? t.plugins.fleet.dismiss_session : t.plugins.fleet.kill_session}
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
        ) : showsTerminal ? (
          // Live (subscribed) terminal — only the focused tile and sessions that
          // need the operator (awaiting_input). Everything else autonomous gets
          // the cheap status block below, so a 9-tile grid stays calm: Athena
          // triages the rest in the background. Click a tile to focus (peek) it.
          // Headless sessions never mount an xterm (no TTY) — status block only.
          <FleetTerminalPane sessionId={s.id} autoFocus={false} />
        ) : (
          <FleetTileStatusBlock session={s} />
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
