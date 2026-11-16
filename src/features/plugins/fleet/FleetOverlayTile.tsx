import { useEffect, useState } from 'react';
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
import { isTombstoneState } from './fleetStateMeta';
import { FleetKillConfirm } from './FleetKillConfirm';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
  const [confirmKill, setConfirmKill] = useState(false);
  // Attention border wins over the base/active border when set.
  const attn = attentionClass(sessionAttention(s));
  const borderCls = attn || (isActive ? 'border-primary/50' : 'border-hair hover:border-hair');
  // Exited / hibernated / expired tiles are in-place TOMBSTONES: they hold their grid
  // slot (so the layout never shifts) but have no PTY to attach — status block
  // only, and the trash control dismisses instead of kills.
  const tombstone = isTombstoneState(s.state);
  const showsTerminal = live && !tombstone && s.mode !== 'headless' && !showInsights;

  // Selecting a tile must also FOCUS its terminal — clicking the frame used to
  // reveal the xterm but still demand a second click inside it before typing.
  // Parent effects run after the child pane's attach effect, so the terminal
  // is attached by the time this fires.
  useEffect(() => {
    if (isActive && showsTerminal) focusTerminal(s.id);
  }, [isActive, showsTerminal, s.id]);

  return (
    <>
    <div
      data-testid={`fleet-overlay-tile-${s.id}`}
      onMouseDown={() => onSelect(s.id)}
      className={`flex flex-col min-h-0 rounded-modal overflow-hidden border bg-[#0a0a0c] transition-colors ${borderCls}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-hair bg-surface-1 shrink-0">
        <FleetStatusDots state={s.state} reason={s.stateReason} />
        <span className="typo-caption truncate flex-1 min-w-0 text-foreground">{s.name ?? s.title ?? s.projectLabel}</span>
        {s.dozing && (
          <Tooltip content={t.plugins.fleet.doze_tooltip}><span
            data-testid={`fleet-tile-dozing-${s.id}`}
            className="shrink-0 inline-flex"
            aria-label={t.plugins.fleet.doze_tooltip}
          >
            <MoonStar className="w-3 h-3 text-role-agent" aria-hidden="true" />
          </span></Tooltip>
        )}
        {s.mode === 'headless' && (
          <Tooltip content={t.plugins.fleet.headless_no_terminal}><span
            className="shrink-0 rounded-card border border-hair bg-surface-1 px-1.5 py-0.5 typo-caption text-ink-2 "
          >
            {t.plugins.fleet.headless_badge}
          </span></Tooltip>
        )}
        <Button variant="ghost" size="sm"
          type="button"
          data-testid={`fleet-tile-view-${s.id}`}
          aria-pressed={showInsights}
          aria-label={showInsights ? t.plugins.fleet.view_terminal : t.plugins.fleet.view_insights}
          tooltip={showInsights ? t.plugins.fleet.view_terminal : t.plugins.fleet.view_insights}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onToggleInsight(s.id)}
          className="shrink-0"
        >
          {showInsights ? <TerminalIcon className="w-3 h-3" /> : <BarChart3 className="w-3 h-3" />}
        </Button>
        <Button variant="ghost" size="icon-sm"
          type="button"
          data-testid={`fleet-tile-kill-${s.id}`}
          aria-label={tombstone ? t.plugins.fleet.dismiss_session : t.plugins.fleet.kill_session}
          tooltip={tombstone ? t.plugins.fleet.dismiss_session : t.plugins.fleet.kill_session}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (tombstone ? onKill(s.id) : setConfirmKill(true))}
          className="shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
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
    {confirmKill && (
      <FleetKillConfirm
        label={s.name ?? s.projectLabel}
        onConfirm={() => { setConfirmKill(false); onKill(s.id); }}
        onCancel={() => setConfirmKill(false)}
      />
    )}
    </>
  );
}
