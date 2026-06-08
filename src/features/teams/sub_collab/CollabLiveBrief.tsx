import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, ExternalLink, Send, Check, CheckCheck, AlertCircle, Activity, Pin } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex, PersonaChip } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, parsePayload } from '../sub_redRoom/useRedRoomFeed';
import { useTeamChannel, parseDeliveries } from './useTeamChannel';
import {
  STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent, dayKey,
} from './collabRender';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * BRIEF variant — "mission-control briefing log".
 *
 * Metaphor: a war-room operations console. A header BAND carries the channel
 * crest + live presence + a data glance (transmissions / working / review),
 * mirroring the questionnaire adoption header. The feed is a dense
 * chronological LOG where every line carries a colour-coded author gutter
 * (member colour / Athena violet / Director sky / user emerald), a sigil, the
 * author in their colour, a status-token kind chip, and the message — with
 * day "chapters" dividing the stream. Reads like a real ops log: scannable,
 * data-forward, restrained. Differs from baseline's chat bubbles by inverting
 * toward density + the at-a-glance band.
 */
export function CollabLiveBrief({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const personaIndex = usePersonaIndex();
  const { items, loaded, exhausted, posting, presence, loadOlder, sendDirective } = useTeamChannel(teamId);
  const [draft, setDraft] = useState('');
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const ordered = useMemo(() => [...items].reverse(), [items]);

  // Glance counters from the loaded window.
  const stats = useMemo(() => {
    let working = 0;
    let review = 0;
    for (const [, st] of presence) {
      if (st === 'working') working++;
      else if (st === 'waiting') review++;
    }
    return { working, review, total: items.length };
  }, [presence, items.length]);

  useEffect(() => {
    const box = scrollBox.current;
    if (box && stickBottom.current) box.scrollTop = box.scrollHeight;
  }, [ordered.length]);

  useEffect(() => {
    const el = topSentinel.current;
    if (!el || exhausted) return;
    const obs = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadOlder(),
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
    if (/@athena\b/i.test(text)) {
      useCompanionStore.getState().setPendingPrompt({
        text: `I posted this in a team channel and tagged you:\n\n"${text}"\n\nPlease respond or help with this.`,
        autoSend: true,
      });
      useCompanionStore.getState().setState('open');
    }
  };

  let lastDay = '';

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* ── Header band ── */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative w-8 h-8 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
            <Radio className="w-4 h-4 text-status-error" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="typo-body-lg font-semibold text-foreground">Team channel</span>
            <span className="typo-label uppercase tracking-[0.2em] text-foreground/55">Mission briefing</span>
          </div>
          <div className="flex-1" />
          {/* Live presence */}
          <div className="flex items-center -space-x-1.5">
            {members.slice(0, 7).map((m) => {
              const st = presence.get(m.personaId);
              return (
                <span
                  key={m.memberId}
                  className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary/80 ring-2 ring-background"
                  title={`${m.name.replace(/^T: /, '')}${st ? ` — ${st}` : ''}`}
                >
                  <PersonaIcon icon={m.icon} color={m.color} size="w-3.5 h-3.5" />
                  {st && (
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background ${st === 'working' ? 'bg-status-info' : 'bg-status-warning'}`} />
                  )}
                </span>
              );
            })}
          </div>
          {/* Data glance */}
          <div className="flex items-center gap-4 typo-data text-foreground tabular-nums pl-2">
            <span className="flex items-center gap-1.5" title="Transmissions">
              <Activity className="w-4 h-4 text-foreground/45" /> {stats.total}
            </span>
            {stats.working > 0 && (
              <span className="text-status-info">{stats.working} working</span>
            )}
            {stats.review > 0 && (
              <span className="text-status-warning flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> {stats.review}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Log feed ── */}
      <div ref={scrollBox} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {!exhausted && ordered.length > 0 && (
          <div ref={topSentinel} className="py-1 text-center">
            <span className="typo-caption text-foreground/40">loading earlier history…</span>
          </div>
        )}
        {exhausted && <p className="py-1 text-center typo-caption text-foreground/35">— start of the channel —</p>}
        {!loaded && <p className="typo-body text-foreground/45 py-3">Tuning in…</p>}
        {loaded && ordered.length === 0 && (
          <p className="typo-body text-foreground/45 py-3">Quiet so far — the channel fills as the team works. Post a directive below to steer the next steps.</p>
        )}
        {ordered.map((item) => {
          const day = dayKey(item.at);
          const divider = day !== lastDay;
          lastDay = day;
          return (
            <div key={item.id}>
              {divider && loaded && (
                <div className="flex items-center gap-2 px-1 pt-3 pb-1.5">
                  <span className="typo-label uppercase tracking-[0.18em] text-foreground/40 font-semibold">
                    {new Date(item.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <BriefRow item={item} personaIndex={personaIndex} />
            </div>
          );
        })}
      </div>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-3 border-t border-border">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Transmit to the team — delivered at the next step boundary. Tag @athena to bring her in…"
          className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={posting}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-status-success/30 bg-status-success/10 typo-body text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

function BriefRow({ item, personaIndex }: { item: TeamChannelItem; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const name = authorName(item, persona);

  // Resolve sigil + kind label + body per kind.
  let body: string | null = item.body;
  let kindLabel = item.label;
  let kindTone = 'text-foreground/55';
  let artifact: { url: string; label: string } | null = null;
  let isError = false;

  if (item.kind === 'step') {
    kindLabel = STEP_VERB[item.label] ?? item.label;
    kindTone = STEP_TONE[item.label] ?? 'text-foreground/60';
    isError = item.label === 'step_failed';
  } else if (item.kind === 'event') {
    const parsed = parsePayload(item.extra);
    body = parsed.summary;
    artifact = parsed.artifact;
    kindTone = FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!;
  } else if (item.kind === 'memory') {
    kindLabel = item.label;
    kindTone = 'text-amber-200/90';
  } else if (item.kind === 'directive') {
    kindLabel = 'directive';
    kindTone = 'text-status-success';
  } else if (item.kind === 'persona' || item.kind === 'athena' || item.kind === 'director') {
    kindLabel = AUTHOR_KIND_META[item.kind].label;
    kindTone = AUTHOR_KIND_META[item.kind].tag;
  }

  const deliveries = item.kind === 'directive' ? parseDeliveries(item) : [];
  const seenIds = [...new Set(deliveries.map((d) => d.persona_id))];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="group relative flex gap-2.5 rounded-card px-2.5 py-1.5 hover:bg-foreground/[0.03] transition-colors"
    >
      {/* Author gutter */}
      <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ backgroundColor: accent, opacity: 0.65 }} />
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary/60 border border-primary/10 flex-shrink-0 mt-0.5">
        {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-3.5 h-3.5" /> : item.kind === 'memory' ? <Pin className="w-3 h-3 text-amber-300/80" /> : <span className="typo-caption text-foreground/40">·</span>}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap leading-tight">
          <span className="typo-body font-medium" style={{ color: accent }}>{name}</span>
          <span className={`typo-caption uppercase tracking-wider ${kindTone}`}>{kindLabel}</span>
          <span className="typo-caption text-foreground/35"><RelativeTime timestamp={item.at} /></span>
        </div>
        {body && (
          <p className={`typo-body leading-snug ${isError ? 'text-status-error/90' : 'text-foreground/80'}`}>{body}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {artifact && (
            <a href={artifact.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-border typo-caption text-status-info hover:bg-secondary/60 transition-colors">
              <ExternalLink className="w-3 h-3" /> {artifact.label}
            </a>
          )}
          {item.kind === 'directive' && (
            <span className="mt-0.5 inline-flex items-center gap-1.5 typo-caption text-foreground/55">
              {seenIds.length > 0 ? (
                <><CheckCheck className="w-3.5 h-3.5 text-status-success" /> seen by {seenIds.slice(0, 3).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)}{seenIds.length > 3 && <span>+{seenIds.length - 3}</span>}</>
              ) : (
                <><Check className="w-3.5 h-3.5" /> delivered at next step boundary</>
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default CollabLiveBrief;
