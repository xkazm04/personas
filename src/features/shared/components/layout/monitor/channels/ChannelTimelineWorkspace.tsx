import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { type FeedTeam, type FeedFilter, type TaggedItem, type PresenceMap } from './types';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

const FILTERS: FeedFilter[] = ['all', 'signal', 'alerts'];
const LEFT_DEFAULT = 224;
const RIGHT_DEFAULT = 384;
const LS_LEFT = 'personas.channelWs.leftW';
const LS_RIGHT = 'personas.channelWs.rightW';

export interface WorkspaceTeam extends FeedTeam {
  selected: boolean;
}

const cleanName = (n: string) => n.replace(/^SDLC[ —-]*/i, '') || n;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readLS(k: string, d: number): number {
  try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; } catch { return d; }
}
function writeLS(k: string, v: number) { try { localStorage.setItem(k, String(Math.round(v))); } catch { /* private mode */ } }

/* ---------------------------------------------------------------------------
 * Performance model
 * ---------------------------------------------------------------------------
 * The whole workspace USED to live inside the `MergedChannels` render-prop, so
 * every feed poll (and every resize/keystroke) re-rendered all four zones —
 * including the markdown-heavy Quick Answer — which froze the surface. Now:
 *   • Resize mutates the panel's width via a ref + direct DOM (NO React state,
 *     so dragging triggers zero re-renders); the value persists to localStorage.
 *   • Each zone is a `memo`'d component. A feed update re-renders only the
 *     centre stream (merged changed) + the team-list counts; Quick Answer and
 *     the composer are isolated (no feed props → they skip).
 *   • The composer owns its own draft state, so typing never re-renders the
 *     stream.
 * ------------------------------------------------------------------------- */

/** A draggable vertical divider — reports horizontal deltas, no re-render. */
function ResizeHandle({ onDrag, onEnd, side }: { onDrag: (deltaX: number) => void; onEnd?: () => void; side: 'left' | 'right' }) {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    let raf = 0;
    let pending = 0;
    const flush = () => { raf = 0; onDrag(pending); pending = 0; };
    const move = (ev: MouseEvent) => {
      pending += ev.clientX - last;
      last = ev.clientX;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      if (pending) onDrag(pending);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onEnd?.();
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

/* ── LEFT — team filter (re-renders on feed for the counts; cheap) ────────── */
const TeamSidebar = memo(function TeamSidebar({
  teams, byTeam, onToggle, allOn, onSetAll, onCollapse,
}: {
  teams: WorkspaceTeam[];
  byTeam: Map<string, TaggedItem[]>;
  onToggle: (id: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col min-h-0 bg-foreground/[0.012]">
      <div className="flex-shrink-0 h-9 px-3 flex items-center gap-2 border-b border-border">
        <Users className="w-3.5 h-3.5 text-foreground/45" />
        <span className="typo-label uppercase tracking-wider text-foreground/55">{t.monitor.channels_teams_label}</span>
        {teams.length > 1 && (
          <button type="button" onClick={() => onSetAll(!allOn)} className="ml-auto typo-caption text-foreground/45 hover:text-foreground/80 transition-colors">
            {allOn ? t.monitor.channels_none : t.monitor.channels_all}
          </button>
        )}
        <button type="button" onClick={onCollapse} title={t.monitor.channels_hide_panel} className="p-1 rounded-interactive text-foreground/40 hover:text-foreground/80 transition-colors">
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
  );
});

/* ── CENTRE — the virtualized stream (re-renders only on merged/filter) ───── */
const CenterStream = memo(function CenterStream({
  merged, filter, personaIndex, onOpen, emptyLabel,
}: {
  merged: TaggedItem[];
  filter: FeedFilter;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen: (item: TeamChannelItem) => void;
  emptyLabel: string;
}) {
  const visible = useMemo(
    () => (filter === 'all' ? merged : merged.filter((r) => matchesFilter(r.item, filter))),
    [merged, filter],
  );
  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <VirtualStream rows={visible} personaIndex={personaIndex} onOpen={onOpen} emptyLabel={emptyLabel} />
    </div>
  );
});

/* ── RIGHT — Quick Answer (no feed props → isolated from the stream) ──────── */
const QuickAnswerSidebar = memo(function QuickAnswerSidebar({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="h-full flex flex-col min-h-0 bg-foreground/[0.012]">
      <div className="flex-shrink-0 h-9 px-3 flex items-center gap-2 border-b border-border">
        <span className="typo-label uppercase tracking-wider text-foreground/55">{t.monitor.quick_title}</span>
        <button type="button" onClick={onCollapse} title={t.monitor.channels_hide_panel} className="ml-auto p-1 rounded-interactive text-foreground/40 hover:text-foreground/80 transition-colors">
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        <QuickAnswerBody />
      </div>
    </div>
  );
});

/* ── BOTTOM — composer (owns its own draft; isolated from the feed) ───────── */
const Composer = memo(function Composer({ feedTeams }: { feedTeams: WorkspaceTeam[] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [teamMenu, setTeamMenu] = useState(false);

  useEffect(() => {
    if (feedTeams.length === 0) { setTarget(null); return; }
    setTarget((cur) => (cur && feedTeams.some((tm) => tm.teamId === cur) ? cur : feedTeams[0]!.teamId));
  }, [feedTeams]);

  const targetTeam = feedTeams.find((tm) => tm.teamId === target) ?? null;

  const send = () => {
    const text = draft.trim();
    if (!text || !target || posting) return;
    setPosting(true);
    postTeamDirective(target, text).catch(silentCatch('channel-composer')).finally(() => setPosting(false));
    setDraft('');
    if (/@athena\b/i.test(text)) {
      useCompanionStore.getState().setPendingPrompt({
        text: `You were tagged in a team channel (team_id: ${target}). The user wrote:\n\n"${text}"\n\nRespond by posting a short reply INTO that team's channel via your post_team_message capability.`,
        autoSend: true,
      });
    }
  };

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border bg-foreground/[0.02]">
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
  );
});

/** The assembled layout — receives the merged feed as props (so it re-renders
 *  only when the feed changes), owns the chrome state (collapse/filter/detail)
 *  and the ref-based panel widths. */
function WorkspaceInner({
  teams, feedTeams, merged, byTeam, working, onToggle, allOn, onSetAll, layoutControl, personaIndex,
}: {
  teams: WorkspaceTeam[];
  feedTeams: WorkspaceTeam[];
  merged: TaggedItem[];
  byTeam: Map<string, TaggedItem[]>;
  working: number;
  onToggle: (id: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  layoutControl?: ReactNode;
  personaIndex: ReturnType<typeof usePersonaIndex>;
}) {
  const { t } = useTranslation();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [detail, setDetail] = useState<TeamChannelItem | null>(null);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftW = useRef(readLS(LS_LEFT, LEFT_DEFAULT));
  const rightW = useRef(readLS(LS_RIGHT, RIGHT_DEFAULT));

  const dragLeft = useCallback((d: number) => {
    leftW.current = clamp(leftW.current + d, 168, 460);
    if (leftRef.current) leftRef.current.style.width = `${leftW.current}px`;
  }, []);
  const dragRight = useCallback((d: number) => {
    rightW.current = clamp(rightW.current - d, 280, 640);
    if (rightRef.current) rightRef.current.style.width = `${rightW.current}px`;
  }, []);
  const persistLeft = useCallback(() => writeLS(LS_LEFT, leftW.current), []);
  const persistRight = useCallback(() => writeLS(LS_RIGHT, rightW.current), []);

  const collapseLeft = useCallback(() => setLeftCollapsed(true), []);
  const expandLeft = useCallback(() => setLeftCollapsed(false), []);
  const collapseRight = useCallback(() => setRightCollapsed(true), []);
  const expandRight = useCallback(() => setRightCollapsed(false), []);
  const onOpen = useCallback((it: TeamChannelItem) => setDetail(it), []);

  const filterLabel: Record<FeedFilter, string> = {
    all: t.monitor.channels_filter_all,
    signal: t.monitor.channels_filter_signal,
    alerts: t.monitor.channels_filter_alerts,
  };

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* Top strip — identity + stats + filter + layout control */}
      <div className="flex-shrink-0 h-11 px-3 flex items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
        <div className="relative w-6 h-6 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
          <Radio className="w-3.5 h-3.5 text-status-error" />
        </div>
        <span className="typo-body font-semibold text-foreground">{t.monitor.channels_combined_title}</span>
        <span className="flex items-center gap-3 typo-data text-foreground/70 tabular-nums ml-1">
          <span className="flex items-center gap-1.5" title="Transmissions"><Activity className="w-4 h-4 text-foreground/40" /> {merged.length}</span>
          {working > 0 && <span className="text-status-info">{working} working</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
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
        {leftCollapsed ? (
          <div className="flex-shrink-0 w-9 border-r border-border bg-foreground/[0.015] flex flex-col items-center py-2 gap-2">
            <button type="button" onClick={expandLeft} title={t.monitor.channels_teams_label} className="p-1.5 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 transition-colors">
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <Users className="w-4 h-4 text-foreground/30" />
            <span className="typo-caption text-foreground/40 tabular-nums">{feedTeams.length}</span>
          </div>
        ) : (
          <>
            <div ref={leftRef} style={{ width: leftW.current }} className="flex-shrink-0 min-h-0">
              <TeamSidebar teams={teams} byTeam={byTeam} onToggle={onToggle} allOn={allOn} onSetAll={onSetAll} onCollapse={collapseLeft} />
            </div>
            <ResizeHandle side="left" onDrag={dragLeft} onEnd={persistLeft} />
          </>
        )}

        <CenterStream merged={merged} filter={filter} personaIndex={personaIndex} onOpen={onOpen} emptyLabel={t.monitor.channels_combined_quiet} />

        {rightCollapsed ? (
          <div className="flex-shrink-0 w-9 border-l border-border bg-foreground/[0.015] flex flex-col items-center py-2 gap-2">
            <button type="button" onClick={expandRight} title={t.monitor.quick_title} className="p-1.5 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 transition-colors">
              <PanelRightOpen className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <ResizeHandle side="right" onDrag={dragRight} onEnd={persistRight} />
            <div ref={rightRef} style={{ width: rightW.current }} className="flex-shrink-0 min-h-0">
              <QuickAnswerSidebar onCollapse={collapseRight} />
            </div>
          </>
        )}
      </div>

      <Composer feedTeams={feedTeams} />

      <ChannelDetailModal item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * CHANNEL TIMELINE WORKSPACE — the flagship cross-team monitor surface. A
 * three-zone layout (team filter · merged stream · Quick Answer) with a
 * team-targeted composer below. See the "Performance model" note above for how
 * feed updates and resize/typing are isolated to keep it smooth at scale.
 */
export function ChannelTimelineWorkspace({
  teams, onToggle, allOn, onSetAll, layoutControl,
}: {
  teams: WorkspaceTeam[];
  onToggle: (teamId: string) => void;
  allOn: boolean;
  onSetAll: (on: boolean) => void;
  layoutControl?: ReactNode;
}) {
  const personaIndex = usePersonaIndex();
  const feedTeams = useMemo(() => teams.filter((tm) => tm.selected), [teams]);

  return (
    <MergedChannels teams={feedTeams}>
      {(merged: TaggedItem[], presenceByTeam: Map<string, PresenceMap>, byTeam: Map<string, TaggedItem[]>) => {
        let working = 0;
        for (const pres of presenceByTeam.values()) for (const st of pres.values()) if (st === 'working') working++;
        return (
          <WorkspaceInner
            teams={teams}
            feedTeams={feedTeams}
            merged={merged}
            byTeam={byTeam}
            working={working}
            onToggle={onToggle}
            allOn={allOn}
            onSetAll={onSetAll}
            layoutControl={layoutControl}
            personaIndex={personaIndex}
          />
        );
      }}
    </MergedChannels>
  );
}

export default ChannelTimelineWorkspace;
