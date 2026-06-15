// Variant B — TEAM LANES.
//
// Metaphor: a mission-ops console. The corner hosts one compact LANE per team
// with live traffic. Each lane carries the team's colour, a live count, and its
// newest line; hovering a lane expands it to the latest 3 and pauses its
// natural timeout. Because every team owns its own lane, a simultaneous burst
// from many teams never contends for one queue — it just lights up more lanes.
// Click a lane → the Timeline, scoped to that team.

import { memo, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, ChevronRight, X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import {
  LiveAvatar, authorName, COPY,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const MAX_LANES = 4;
const PER_LANE = 3;

interface Lane { teamId: string; teamName: string; teamColor: string; items: LiveMessage[] }

function LaneCard({
  lane, onDismiss, onOpenTimeline, onHover, reducedMotion,
}: {
  lane: Lane;
  onDismiss: (id: string) => void;
  onOpenTimeline: (teamId?: string) => void;
  onHover: (id: string, hovered: boolean) => void;
  reducedMotion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const newest = lane.items[0]!;
  const setHover = (h: boolean) => {
    setOpen(h);
    for (const it of lane.items) onHover(it.id, h);
  };

  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pointer-events-auto w-[320px] overflow-hidden rounded-card border border-primary/12 bg-background/95 shadow-elevation-3 backdrop-blur-md"
      style={{ boxShadow: `inset 3px 0 0 ${lane.teamColor}` }}
    >
      {/* Lane header — team identity + live count, opens the Timeline. */}
      <button
        type="button"
        onClick={() => onOpenTimeline(lane.teamId)}
        title={COPY.openTimeline}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: lane.teamColor }} />
        <span className="typo-body font-semibold text-foreground/90 truncate">{lane.teamName}</span>
        <span
          className="ml-1 flex-shrink-0 rounded-full px-1.5 py-0.5 typo-caption font-medium tabular-nums"
          style={{ backgroundColor: `${lane.teamColor}22`, color: lane.teamColor }}
        >
          {lane.items.length} {COPY.newLabel}
        </span>
        <ChevronRight className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-foreground/35" />
      </button>

      {/* Collapsed: newest line only. Expanded (hover): the latest 3. */}
      <div className="border-t border-primary/8">
        {(open ? lane.items.slice(0, PER_LANE) : [newest]).map((m) => (
          <div key={m.id} className="group/row flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/[0.025]">
            <LiveAvatar m={m} size="xs" />
            <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${m.tone}`}>{m.event}</span>
            <span className="typo-caption text-foreground/55 truncate">
              {m.kind !== 'persona' && <span className="text-foreground/40">{authorName(m)} · </span>}
              {m.message}
            </span>
            <span className="ml-auto flex-shrink-0 typo-caption text-foreground/40">
              <RelativeTime timestamp={m.at} />
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDismiss(m.id); }}
              aria-label={COPY.dismiss}
              className="flex-shrink-0 text-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function LiveTeamLanesImpl({ messages, onDismiss, onDismissAll, onOpenTimeline, onHover, reducedMotion }: LiveVariantProps) {
  const lanes = useMemo<Lane[]>(() => {
    const byTeam = new Map<string, Lane>();
    for (const m of messages) {
      const lane = byTeam.get(m.teamId);
      if (lane) lane.items.push(m);
      else byTeam.set(m.teamId, { teamId: m.teamId, teamName: m.teamName, teamColor: m.teamColor, items: [m] });
    }
    return [...byTeam.values()];
  }, [messages]);

  if (lanes.length === 0) return null;
  const visible = lanes.slice(0, MAX_LANES);
  const overflowTeams = lanes.length - visible.length;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[320px] flex-col items-end gap-2">
      <div className="pointer-events-auto flex w-full items-center gap-2 self-end rounded-full border border-primary/12 bg-secondary/80 px-3 py-1 backdrop-blur-sm">
        <Radio className="h-3.5 w-3.5 text-status-error" />
        <span className="typo-caption font-medium text-foreground/70">{COPY.title}</span>
        <span className="typo-caption text-foreground/45 tabular-nums">
          {COPY.teamsActive(lanes.length, messages.length)}
        </span>
        <button
          type="button"
          onClick={onDismissAll}
          className="ml-auto typo-caption font-medium text-foreground/55 transition-colors hover:text-foreground"
        >
          {COPY.dismissAll}
        </button>
      </div>

      <div className="flex w-full flex-col gap-2">
        <AnimatePresence initial={false}>
          {visible.map((lane) => (
            <LaneCard
              key={lane.teamId}
              lane={lane}
              onDismiss={onDismiss}
              onOpenTimeline={onOpenTimeline}
              onHover={onHover}
              reducedMotion={reducedMotion}
            />
          ))}
        </AnimatePresence>
        {overflowTeams > 0 && (
          <span className="self-end typo-caption text-foreground/45">{COPY.more(overflowTeams)} teams</span>
        )}
      </div>
    </div>
  );
}

export const LiveTeamLanes = memo(LiveTeamLanesImpl);
export default LiveTeamLanes;
