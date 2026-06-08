import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, ExternalLink, Send, Check, CheckCheck, Pin, AlertCircle } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex, PersonaChip } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, parsePayload } from '../sub_redRoom/useRedRoomFeed';
import { useTeamChannel, parseDeliveries } from './useTeamChannel';
import {
  STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent,
} from './collabRender';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/**
 * CORRESPONDENCE variant — "the team is talking".
 *
 * Metaphor: a warm group conversation. Messages render as voiced BUBBLES — the
 * user right-aligned, personas left with their avatar, with consecutive
 * messages from one author grouped under a single avatar (chat-app rhythm).
 * Athena and Director arrive as centred INTERJECTION ribbons (a coach speaking
 * up), and the step layer reads as quiet system "status" lines so the human
 * voices dominate. Softer header (who's here). Differs from baseline (flat
 * rows) and Brief (dense log) by leaning all-in on the conversation feel.
 */
export function CollabLiveCorrespondence({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const personaIndex = usePersonaIndex();
  const { items, loaded, exhausted, posting, presence, loadOlder, sendDirective } = useTeamChannel(teamId);
  const [draft, setDraft] = useState('');
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const ordered = useMemo(() => [...items].reverse(), [items]);

  // Group rhythm: hide the avatar/name header when the previous item shares the
  // same author identity (consecutive-run grouping, chat-app style).
  const identityOf = (it: TeamChannelItem) => `${it.kind}:${it.personaId ?? ''}`;

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

  const workingNames = members
    .filter((m) => presence.get(m.personaId) === 'working')
    .map((m) => m.name.replace(/^T: /, ''));

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── Soft header: who's here ── */}
      <div className="flex-shrink-0 flex items-center gap-3 pb-2">
        <div className="relative w-7 h-7 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
          <Radio className="w-3.5 h-3.5 text-status-error" />
        </div>
        <div className="min-w-0">
          <div className="typo-body font-semibold text-foreground leading-tight">Team channel</div>
          <div className="typo-caption text-foreground/50 leading-tight truncate">
            {workingNames.length > 0 ? `${workingNames.slice(0, 3).join(', ')} working…` : `${members.length} members`}
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center -space-x-1.5">
          {members.slice(0, 8).map((m) => {
            const st = presence.get(m.personaId);
            return (
              <span
                key={m.memberId}
                className="relative inline-flex items-center justify-center w-7 h-7 rounded-full bg-secondary/80 ring-2 ring-background"
                title={`${m.name.replace(/^T: /, '')}${st ? ` — ${st}` : ''}`}
                style={st === 'working' ? { boxShadow: `0 0 0 2px ${m.color ?? '#60a5fa'}` } : undefined}
              >
                <PersonaIcon icon={m.icon} color={m.color} size="w-4 h-4" />
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Conversation ── */}
      <div ref={scrollBox} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto rounded-card border border-border bg-foreground/[0.01] px-3 py-3 space-y-1">
        {!exhausted && ordered.length > 0 && (
          <div ref={topSentinel} className="py-1 text-center">
            <span className="typo-caption text-foreground/40">loading earlier history…</span>
          </div>
        )}
        {exhausted && <p className="py-1 text-center typo-caption text-foreground/35">— start of the conversation —</p>}
        {!loaded && <p className="typo-body text-foreground/45 py-3">Tuning in…</p>}
        {loaded && ordered.length === 0 && (
          <p className="typo-body text-foreground/45 py-3">Quiet so far — say something to the team. Tag @athena to bring her in.</p>
        )}
        {ordered.map((item, i) => {
          const prev = i > 0 ? ordered[i - 1] : undefined;
          const grouped = !!prev && identityOf(prev) === identityOf(item);
          return <CorrespondenceRow key={item.id} item={item} grouped={grouped} personaIndex={personaIndex} />;
        })}
      </div>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 flex items-center gap-2 pt-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Say something to the team… Tag @athena to bring her in"
          className="flex-1 px-3.5 py-2.5 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={posting}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-interactive border border-status-success/30 bg-status-success/10 typo-body text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

function CorrespondenceRow({ item, grouped, personaIndex }: { item: TeamChannelItem; grouped: boolean; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const name = authorName(item, persona);
  const isUser = item.kind === 'directive';
  const isInterjection = item.kind === 'athena' || item.kind === 'director';

  // System/status line — the step layer, quiet and centred-left so human voices lead.
  if (item.kind === 'step') {
    const verb = STEP_VERB[item.label] ?? item.label;
    const tone = STEP_TONE[item.label] ?? 'text-foreground/55';
    const gate = item.label === 'status_awaiting_review';
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}
        className={`flex items-center gap-2 pl-9 py-0.5 ${gate ? 'rounded-card border border-status-warning/25 bg-status-warning/5 px-2' : ''}`}>
        {gate && <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />}
        <span className="typo-caption" style={{ color: accent }}>{name}</span>
        <span className={`typo-caption ${tone}`}>{verb}</span>
        {item.body && <span className="typo-caption text-foreground/55 truncate">· {item.body}</span>}
        <span className="ml-auto typo-caption text-foreground/30 flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
      </motion.div>
    );
  }

  // Bus event — a quiet status with artifact.
  if (item.kind === 'event') {
    const { summary, artifact } = parsePayload(item.extra);
    const fam = eventFamily(item.label);
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="flex items-baseline gap-2 pl-9 py-0.5">
        <span className="typo-caption" style={{ color: accent }}>{name}</span>
        <span className={`typo-caption font-mono ${FAMILY_TEXT[fam] ?? FAMILY_TEXT.other}`}>{item.label}</span>
        {summary && <span className="typo-caption text-foreground/65 truncate">{summary}</span>}
        {artifact && (
          <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 typo-caption text-status-info hover:underline flex-shrink-0">
            <ExternalLink className="w-3 h-3" /> {artifact.label}
          </a>
        )}
        <span className="ml-auto typo-caption text-foreground/30 flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
      </motion.div>
    );
  }

  // Memory — a pinned note line.
  if (item.kind === 'memory') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="flex items-baseline gap-2 pl-9 py-0.5">
        <Pin className="w-3 h-3 text-amber-300/80 flex-shrink-0 self-center" />
        <span className="typo-caption uppercase tracking-wider text-amber-300/80">{item.label}</span>
        <span className="typo-caption text-foreground/70 truncate">{item.body}</span>
      </motion.div>
    );
  }

  // Athena / Director — centred interjection ribbon.
  if (isInterjection) {
    const meta = AUTHOR_KIND_META[item.kind as 'athena' | 'director'];
    return (
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex justify-center py-1">
        <div className={`max-w-[88%] rounded-card border px-3 py-2 ${meta.bubble}`}>
          <div className="flex items-center gap-1.5">
            <meta.Icon className={`w-3.5 h-3.5 ${meta.iconColor}`} />
            <span className={`typo-caption uppercase tracking-wider font-semibold ${meta.tag}`}>{meta.label}</span>
            <span className="typo-caption text-foreground/35"><RelativeTime timestamp={item.at} /></span>
          </div>
          <p className="mt-0.5 typo-body text-foreground/85 whitespace-pre-wrap">{item.body}</p>
        </div>
      </motion.div>
    );
  }

  // User directive — right-aligned bubble with receipts.
  if (isUser) {
    const deliveries = parseDeliveries(item);
    const seenIds = [...new Set(deliveries.map((d) => d.persona_id))];
    return (
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex justify-end py-0.5">
        <div className="max-w-[78%] rounded-card rounded-br-sm border border-status-success/25 bg-status-success/10 px-3 py-2">
          <p className="typo-body text-foreground/90 whitespace-pre-wrap">{item.body}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 typo-caption text-foreground/55 flex-wrap">
            {seenIds.length > 0 ? (
              <><CheckCheck className="w-3.5 h-3.5 text-status-success" /> seen by {seenIds.slice(0, 3).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)}{seenIds.length > 3 && <span>+{seenIds.length - 3}</span>}</>
            ) : (
              <><Check className="w-3.5 h-3.5" /> delivered at next step boundary</>
            )}
            <span className="text-foreground/30"><RelativeTime timestamp={item.at} /></span>
          </p>
        </div>
      </motion.div>
    );
  }

  // Persona channel_post — left bubble, avatar shown unless grouped with prev.
  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex gap-2.5 py-0.5">
      <span className="w-7 flex-shrink-0 flex justify-center">
        {!grouped && (
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-secondary/70 border flex-shrink-0 mt-0.5" style={{ borderColor: accent }}>
            {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" /> : <span className="typo-caption text-foreground/40">·</span>}
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0">
        {!grouped && (
          <div className="flex items-center gap-2 leading-tight">
            <span className="typo-body font-medium" style={{ color: accent }}>{name}</span>
            <span className="typo-caption text-foreground/35"><RelativeTime timestamp={item.at} /></span>
          </div>
        )}
        <div className="max-w-[78%] rounded-card rounded-tl-sm border border-primary/12 bg-secondary/20 px-3 py-2 mt-0.5">
          <p className="typo-body text-foreground/85 whitespace-pre-wrap">{item.body}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default CollabLiveCorrespondence;
