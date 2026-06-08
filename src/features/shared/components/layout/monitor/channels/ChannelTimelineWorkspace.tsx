import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Radio, Activity, Send, Users, ChevronDown, Check,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { ChannelDetailModal } from '@/features/teams/sub_collab/ChannelDetailModal';
import { postTeamDirective } from '@/api/pipeline/teamChannel';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { silentCatch } from '@/lib/silentCatch';
import { QuickAnswerBody } from '@/features/shared/components/layout/quick-answer/QuickAnswerBody';
import { MergedChannels } from './mergedFeed';
import { VirtualStream } from './VirtualStream';
import { matchesFilter } from './feedFilter';
import { type FeedTeam, type FeedFilter } from './types';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

const FILTERS: FeedFilter[] = ['all', 'signal', 'alerts'];
const LEFT_DEFAULT = 224;
const RIGHT_DEFAULT = 384;

export interface WorkspaceTeam extends FeedTeam {
  selected: boolean;
}

const cleanName = (n: string) => n.replace(/^SDLC[ —-]*/i, '') || n;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A draggable vertical divider that reports horizontal deltas. */
function ResizeHandle({ onDrag, side }: { onDrag: (deltaX: number) => void; side: 'left' | 'right' }) {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    <div
      onMouseDown={down}
      role="separator"
      aria-orientation="vertical"
      className={`group/handle relative w-1.5 flex-shrink-0 cursor-col-resize ${side === 'left' ? 'border-l' : 'border-r'} border-border`}
    >
      <div className="absolute inset-y-0 -inset-x-0.5 group-hover/handle:bg-primary/30 transition-colors" />
    </div>
  );
}

/**
 * CHANNEL TIMELINE WORKSPACE — the flagship cross-team monitor surface.
 *
 * A three-zone layout around the combined timeline: a LEFT sidebar to filter
 * teams (replacing the topbar chips), the virtualized merged stream in the
 * CENTRE, a RIGHT sidebar embedding the Quick Answer queue (so triage lives
 * beside the live feed), and a BOTTOM composer to post a directive to a chosen
 * team. Both sidebars are resizable (drag handle) and collapsible to a thin
 * rail. `MergedChannels` wraps the whole thing so every zone shares one merged,
 * team-tagged feed.
 */
export function ChannelTimelineWorkspace({
  teams,
  onToggle,
  allOn,
  onSetAll,
  layoutControl,
}: {
  teams: WorkspaceTeam[];
  onToggle: (teamId: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  layoutControl?: ReactNode;
}) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();

  const feedTeams = useMemo(() => teams.filter((tm) => tm.selected), [teams]);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [rightW, setRightW] = useState(RIGHT_DEFAULT);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  // Composer — which selected team to post the directive to.
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [teamMenu, setTeamMenu] = useState(false);
  useEffect(() => {
    // Keep the target on a still-selected team.
    if (feedTeams.length === 0) { setTarget(null); return; }
    if (!target || !feedTeams.some((tm) => tm.teamId === target)) setTarget(feedTeams[0]!.teamId);
  }, [feedTeams, target]);

  const targetTeam = feedTeams.find((tm) => tm.teamId === target) ?? null;

  const filterLabel: Record<FeedFilter, string> = {
    all: t.monitor.channels_filter_all,
    signal: t.monitor.channels_filter_signal,
    alerts: t.monitor.channels_filter_alerts,
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !target || posting) return;
    setPosting(true);
    postTeamDirective(target, text)
      .catch(silentCatch('channel-composer'))
      .finally(() => setPosting(false));
    setDraft('');
    // Tagging Athena runs her turn in the background, posting back in-channel.
    if (/@athena\b/i.test(text)) {
      useCompanionStore.getState().setPendingPrompt({
        text: `You were tagged in a team channel (team_id: ${target}). The user wrote:\n\n"${text}"\n\nRespond by posting a short reply INTO that team's channel via your post_team_message capability.`,
        autoSend: true,
      });
    }
  };

  return (
    <MergedChannels teams={feedTeams}>
      {(merged, presenceByTeam, byTeam) => {
        let working = 0;
        for (const pres of presenceByTeam.values()) for (const st of pres.values()) if (st === 'working') working++;
        const visible = filter === 'all' ? merged : merged.filter((r) => matchesFilter(r.item, filter));

        return (
          <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
            {/* Top strip — identity + layout control */}
            <div className="flex-shrink-0 h-11 px-3 flex items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
              <div className="relative w-6 h-6 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
                <Radio className="w-3.5 h-3.5 text-status-error" />
              </div>
              <span className="typo-body font-semibold text-foreground">{t.monitor.channels_combined_title}</span>
              <span className="flex items-center gap-3 typo-data text-foreground/70 tabular-nums ml-1">
                <span className="flex items-center gap-1.5" title="Transmissions"><Activity className="w-4 h-4 text-foreground/40" /> {visible.length}</span>
                {working > 0 && <span className="text-status-info">{working} working</span>}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {/* Noise filter */}
                <div className="flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      aria-pressed={filter === f}
                      className={`px-2.5 py-0.5 rounded-full typo-caption transition-colors ${filter === f ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/50 hover:text-foreground/80'}`}
                    >
                      {filterLabel[f]}
                    </button>
                  ))}
                </div>
                {layoutControl}
              </div>
            </div>

            {/* Three-zone body */}
            <div className="flex-1 min-h-0 flex">
              {/* LEFT — teams filter */}
              {leftCollapsed ? (
                <div className="flex-shrink-0 w-9 border-r border-border bg-foreground/[0.015] flex flex-col items-center py-2 gap-2">
                  <button type="button" onClick={() => setLeftCollapsed(false)} title={t.monitor.channels_teams_label} className="p-1.5 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 transition-colors">
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                  <Users className="w-4 h-4 text-foreground/30" />
                  <span className="typo-caption text-foreground/40 tabular-nums">{feedTeams.length}</span>
                </div>
              ) : (
                <>
                  <div style={{ width: leftW }} className="flex-shrink-0 flex flex-col min-h-0 bg-foreground/[0.012]">
                    <div className="flex-shrink-0 h-9 px-3 flex items-center gap-2 border-b border-border">
                      <Users className="w-3.5 h-3.5 text-foreground/45" />
                      <span className="typo-label uppercase tracking-wider text-foreground/55">{t.monitor.channels_teams_label}</span>
                      {teams.length > 1 && (
                        <button type="button" onClick={() => onSetAll(!allOn)} className="ml-auto typo-caption text-foreground/45 hover:text-foreground/80 transition-colors">
                          {allOn ? t.monitor.channels_none : t.monitor.channels_all}
                        </button>
                      )}
                      <button type="button" onClick={() => setLeftCollapsed(true)} title={t.monitor.channels_hide_panel} className="p-1 rounded-interactive text-foreground/40 hover:text-foreground/80 transition-colors">
                        <PanelLeftClose className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
                      {teams.map((tm) => {
                        const count = byTeam.get(tm.teamId)?.length ?? 0;
                        return (
                          <button
                            key={tm.teamId}
                            type="button"
                            onClick={() => onToggle(tm.teamId)}
                            aria-pressed={tm.selected}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left transition-colors ${tm.selected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-secondary/30'}`}
                          >
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded border flex-shrink-0" style={{ borderColor: tm.teamColor, backgroundColor: tm.selected ? tm.teamColor : 'transparent' }}>
                              {tm.selected && <Check className="w-3 h-3 text-background" />}
                            </span>
                            <span className={`typo-body truncate ${tm.selected ? 'text-foreground' : 'text-foreground/55'}`}>{cleanName(tm.teamName)}</span>
                            {tm.selected && count > 0 && <span className="ml-auto typo-caption text-foreground/40 tabular-nums">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <ResizeHandle side="left" onDrag={(d) => setLeftW((w) => clamp(w + d, 168, 420))} />
                </>
              )}

              {/* CENTRE — the merged stream */}
              <div className="flex-1 min-w-0 flex flex-col min-h-0">
                <VirtualStream rows={visible} personaIndex={personaIndex} onOpen={setDetail} emptyLabel={t.monitor.channels_combined_quiet} />
              </div>

              {/* RIGHT — Quick Answer */}
              {rightCollapsed ? (
                <div className="flex-shrink-0 w-9 border-l border-border bg-foreground/[0.015] flex flex-col items-center py-2 gap-2">
                  <button type="button" onClick={() => setRightCollapsed(false)} title={t.monitor.quick_title} className="p-1.5 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 transition-colors">
                    <PanelRightOpen className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <ResizeHandle side="right" onDrag={(d) => setRightW((w) => clamp(w - d, 300, 560))} />
                  <div style={{ width: rightW }} className="flex-shrink-0 flex flex-col min-h-0 bg-foreground/[0.012]">
                    <div className="flex-shrink-0 h-9 px-3 flex items-center gap-2 border-b border-border">
                      <span className="typo-label uppercase tracking-wider text-foreground/55">{t.monitor.quick_title}</span>
                      <button type="button" onClick={() => setRightCollapsed(true)} title={t.monitor.channels_hide_panel} className="ml-auto p-1 rounded-interactive text-foreground/40 hover:text-foreground/80 transition-colors">
                        <PanelRightClose className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
                      <QuickAnswerBody />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* BOTTOM — team-targeted composer */}
            <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border bg-foreground/[0.02]">
              {/* Team picker */}
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setTeamMenu((v) => !v)}
                  disabled={feedTeams.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border border-border bg-secondary/30 typo-caption text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: targetTeam?.teamColor ?? 'var(--color-foreground)' }} />
                  <span className="max-w-[120px] truncate">{targetTeam ? cleanName(targetTeam.teamName) : t.monitor.channels_composer_pick}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-foreground/50" />
                </button>
                {teamMenu && feedTeams.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setTeamMenu(false)} />
                    <div className="absolute bottom-full left-0 mb-1 z-20 min-w-[180px] max-h-60 overflow-y-auto rounded-card border border-border bg-background shadow-elevation-3 p-1">
                      {feedTeams.map((tm) => (
                        <button
                          key={tm.teamId}
                          type="button"
                          onClick={() => { setTarget(tm.teamId); setTeamMenu(false); }}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left typo-caption transition-colors ${tm.teamId === target ? 'bg-primary/10 text-foreground' : 'text-foreground/70 hover:bg-secondary/40'}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tm.teamColor }} />
                          <span className="truncate">{cleanName(tm.teamName)}</span>
                          {tm.teamId === target && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                disabled={!target}
                placeholder={targetTeam ? t.monitor.channels_composer_placeholder : t.monitor.channels_composer_pick}
                className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={send}
                disabled={!draft.trim() || !target || posting}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-status-success/30 bg-status-success/10 typo-body text-status-success hover:bg-status-success/20 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" /> {t.monitor.channels_composer_send}
              </button>
            </div>

            <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
          </div>
        );
      }}
    </MergedChannels>
  );
}

export default ChannelTimelineWorkspace;
