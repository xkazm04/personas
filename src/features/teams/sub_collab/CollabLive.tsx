import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Send, Pin, Check, CheckCheck, AlertCircle } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex, PersonaChip } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, memberColor, parsePayload } from '../sub_redRoom/useRedRoomFeed';
import { useTeamChannel, parseDeliveries } from './useTeamChannel';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * Collab LIVE — the production Design B living chat.
 *
 * Real data end-to-end: the `list_team_channel` read-model (step layer ∪ bus ∪
 * memories, keyset-paged), TEAM_ASSIGNMENT_PROGRESS push + poll fallback,
 * presence derived from running steps, and a directive composer whose
 * messages are delivered at step boundaries and accumulate read-receipts
 * (✓✓ seen by …) written back by the orchestrator.
 */

/** Human verb per step-layer kind. */
const STEP_VERB: Record<string, string> = {
  created: 'created the mission',
  step_running: 'started',
  step_done: 'finished',
  step_failed: 'failed',
  step_skipped: 'skipped',
  status_awaiting_review: 'needs your review',
  status_done: 'mission complete',
  qa_changes_requested_rework: 'QA requested changes — rework round',
};

const STEP_TONE: Record<string, string> = {
  step_running: 'text-blue-300',
  step_done: 'text-emerald-300',
  step_failed: 'text-red-300',
  step_skipped: 'text-foreground/45',
  status_awaiting_review: 'text-amber-300',
  status_done: 'text-emerald-300',
  qa_changes_requested_rework: 'text-amber-300',
  created: 'text-foreground/60',
};

const FAMILY_TEXT: Record<string, string> = {
  handoff: 'text-violet-300', pr: 'text-blue-300', qa: 'text-amber-300',
  release: 'text-emerald-300', failure: 'text-red-300', build: 'text-sky-300',
  other: 'text-foreground/60',
};

export function CollabLive({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const personaIndex = usePersonaIndex();
  const { items, loaded, exhausted, posting, presence, loadOlder, sendDirective } = useTeamChannel(teamId);
  const [draft, setDraft] = useState('');
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  // Chronological render (oldest → newest), chat-style.
  const ordered = useMemo(() => [...items].reverse(), [items]);

  // Stick to the newest message unless the user scrolled up into history.
  useEffect(() => {
    const box = scrollBox.current;
    if (box && stickBottom.current) box.scrollTop = box.scrollHeight;
  }, [ordered.length]);

  // Load older pages when the top sentinel becomes visible.
  useEffect(() => {
    const el = topSentinel.current;
    if (!el || exhausted) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder();
      },
      { rootMargin: '80px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [exhausted, loadOlder, ordered.length]);

  const onScroll = () => {
    const box = scrollBox.current;
    if (!box) return;
    stickBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  };

  const send = () => {
    const text = draft.trim();
    if (!text || posting) return;
    setDraft('');
    void sendDirective(text);
    stickBottom.current = true;
  };

  return (
    <div className="h-full flex flex-col gap-2 min-h-0" data-testid="collab-live">
      {/* Presence header */}
      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
        {members.map((m) => {
          const status = presence.get(m.personaId);
          return (
            <span key={m.memberId} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive bg-secondary/25 border border-primary/10" title={`${m.name}${status ? ` — ${status}` : ''}`}>
              <PersonaIcon icon={m.icon} color={m.color} size="w-3.5 h-3.5" />
              <span className="typo-caption text-foreground/75 max-w-[110px] truncate">{m.name.replace(/^T: /, '')}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'working' ? 'bg-blue-400' : status === 'waiting' ? 'bg-amber-400' : 'bg-foreground/20'}`} />
            </span>
          );
        })}
      </div>

      {/* The channel */}
      <div ref={scrollBox} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-background/50 px-3 py-2 space-y-1.5">
        {!exhausted && ordered.length > 0 && (
          <div ref={topSentinel} className="py-1 text-center">
            <span className="typo-caption text-foreground/40">loading earlier history…</span>
          </div>
        )}
        {exhausted && (
          <p className="py-1 text-center typo-caption text-foreground/35">— start of the channel —</p>
        )}
        {!loaded && <p className="typo-body text-foreground/45 py-3">Tuning in…</p>}
        {loaded && ordered.length === 0 && (
          <p className="typo-body text-foreground/45 py-3">Quiet so far — the channel fills as the team works. Post a directive below to steer the next steps.</p>
        )}
        {ordered.map((item) => (
          <ChannelRow key={item.id} item={item} personaIndex={personaIndex} />
        ))}
      </div>

      {/* Directive composer */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Message the team — delivered at the next step boundary, receipts below your message…"
          className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-primary/15 typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
          data-testid="collab-composer"
        />
        <button
          type="button"
          onClick={send}
          disabled={posting}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-emerald-500/30 bg-emerald-500/10 typo-body text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

function ChannelRow({ item, personaIndex }: { item: TeamChannelItem; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const color = memberColor(persona, item.personaId);
  const name = persona ? persona.name.replace(/^T: /, '') : item.kind === 'directive' ? 'You' : 'System';

  if (item.kind === 'directive') {
    const deliveries = parseDeliveries(item);
    const seenIds = [...new Set(deliveries.map((d) => d.persona_id))];
    return (
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex justify-end">
        <div className="max-w-[80%] rounded-card border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <Pin className="w-3 h-3 text-emerald-300 flex-shrink-0" />
            <span className="typo-caption font-medium text-emerald-200">Your directive</span>
            <span className="typo-caption text-foreground/40"><RelativeTime timestamp={item.at} /></span>
          </div>
          <p className="mt-0.5 typo-body text-foreground/90 whitespace-pre-wrap">{item.body}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 typo-caption text-foreground/55 flex-wrap">
            {seenIds.length > 0 ? (
              <>
                <CheckCheck className="w-3.5 h-3.5 text-emerald-300" /> seen by
                {seenIds.slice(0, 3).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)}
                {seenIds.length > 3 && <span>+{seenIds.length - 3}</span>}
              </>
            ) : (
              <><Check className="w-3.5 h-3.5" /> posted — lands at the next step boundary</>
            )}
          </p>
        </div>
      </motion.div>
    );
  }

  if (item.kind === 'memory') {
    return (
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex gap-2 items-baseline">
        <span className="typo-caption uppercase tracking-wider text-amber-300/80 flex-shrink-0">{item.label}</span>
        <span className="typo-caption flex-shrink-0" style={{ color }}>{name}</span>
        <span className="typo-caption text-foreground/70 truncate" title={item.body ?? undefined}>{item.body}</span>
        <span className="ml-auto typo-caption text-foreground/35 flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
      </motion.div>
    );
  }

  if (item.kind === 'event') {
    const { summary, artifact } = parsePayload(item.extra);
    const fam = eventFamily(item.label);
    return (
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex gap-2.5">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary/60 border border-primary/10 flex-shrink-0 mt-0.5">
          {persona && <PersonaIcon icon={persona.icon} color={persona.color} size="w-3.5 h-3.5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-body font-medium" style={{ color }}>{name}</span>
            <span className={`typo-caption font-mono ${FAMILY_TEXT[fam] ?? FAMILY_TEXT.other}`}>{item.label}</span>
            <span className="typo-caption text-foreground/40"><RelativeTime timestamp={item.at} /></span>
          </div>
          {summary && <p className="typo-body text-foreground/80">{summary}</p>}
          {artifact && (
            <a href={artifact.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-blue-300 hover:bg-secondary/60 transition-colors">
              <ExternalLink className="w-3 h-3" /> {artifact.label}
            </a>
          )}
        </div>
      </motion.div>
    );
  }

  // step layer
  const verb = STEP_VERB[item.label] ?? item.label;
  const tone = STEP_TONE[item.label] ?? 'text-foreground/60';
  const isGate = item.label === 'status_awaiting_review';
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={`flex gap-2.5 ${isGate ? 'rounded-card border border-amber-500/25 bg-amber-500/5 px-2 py-1.5' : ''}`}>
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary/60 border border-primary/10 flex-shrink-0 mt-0.5">
        {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5 text-foreground/40" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="typo-body font-medium" style={{ color }}>{name}</span>
          <span className={`typo-caption ${tone}`}>{verb}</span>
          <span className="typo-caption text-foreground/40"><RelativeTime timestamp={item.at} /></span>
        </div>
        {item.body && <p className="typo-body text-foreground/80 truncate" title={item.body}>{item.body}</p>}
      </div>
    </motion.div>
  );
}

export default CollabLive;
