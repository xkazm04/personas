import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ExternalLink, Send, Check, CheckCheck, Pin, AlertCircle, SkipForward, Ban, RotateCcw, ClipboardCheck, Activity, Sparkles, CornerDownRight, Reply, X, ArrowDown, Search } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex, PersonaChip, useAssignmentSteps } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily } from '../sub_redRoom/useRedRoomFeed';
import { payloadSummary } from './payloadView';
import { useTeamChannel, parseDeliveries } from './useTeamChannel';
import {
  STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent,
  type ChannelMember,
} from './collabRender';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { ChannelDetailModal } from './ChannelDetailModal';
import { QuickAnswerReviewCard } from '@/features/shared/components/layout/quick-answer/QuickAnswerReviewCard';
import { resolveTeamAssignmentReview } from '@/api/pipeline/assignments';
import { createTeamMemory } from '@/api/pipeline/teamMemories';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

/**
 * CORRESPONDENCE — the flagship team channel (C5 winner).
 *
 * A bordered "channel" card: a HEADER BAND (crest · identity · live presence
 * with status dots · a data glance) over the conversation, with the composer as
 * a band at the bottom. Every message uses one uniform TWO-ROW shape —
 * SOURCE + EVENT on row 1, the MESSAGE in an accent-tinted container on row 2
 * (see `CorrespondenceRow` / `resolveRow`). "Needs your review" rows carry the
 * inline team-review intervention; pending manual reviews surface via the
 * shared QuickAnswerReviewCard. A designed empty state explains the channel.
 */
const DRAFT_PREFIX = 'personas.channel.draft.';
const FILTER_PREFIX = 'personas.channel.filters.';

export function CollabLiveCorrespondence({ teamId, members, teamName }: { teamId: string; members: ChannelMember[]; teamName?: string }) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const { items, loaded, exhausted, posting, presence, refreshHead, loadOlder, sendDirective } = useTeamChannel(teamId);
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  // Per-team draft persistence: a half-written directive survives switching
  // teams or closing the app. Persisting happens in updateDraft (not an
  // effect) so a team switch can't race the load and clobber another key.
  useEffect(() => {
    try {
      setDraft(localStorage.getItem(DRAFT_PREFIX + teamId) ?? '');
    } catch (err) {
      silentCatch('collab/correspondence:draftLoad')(err);
    }
  }, [teamId]);

  const updateDraft = (next: string | ((d: string) => string)) => {
    setDraft((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      try {
        if (value) localStorage.setItem(DRAFT_PREFIX + teamId, value);
        else localStorage.removeItem(DRAFT_PREFIX + teamId);
      } catch (err) {
        silentCatch('collab/correspondence:draftSave')(err);
      }
      return value;
    });
  };

  // Autosize the composer up to ~6 lines; beyond that it scrolls.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastSeenIdRef = useRef<string | null>(null);

  const memberIds = useMemo(() => new Set(members.map((m) => m.personaId)), [members]);
  const ordered = useMemo(() => [...items].reverse(), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [replyTarget, setReplyTarget] = useState<TeamChannelItem | null>(null);
  const [detailItem, setDetailItem] = useState<TeamChannelItem | null>(null);

  // Channel filters — kind (conversation vs system activity), author, text.
  // Kind + author persist per team (the text query is ephemeral by design).
  // Like drafts, persisting happens in the handlers — not an effect — so a
  // team switch can't race the restore and clobber another team's key.
  const [kindFilter, setKindFilter] = useState<'all' | 'talk' | 'activity'>('all');
  const [authorFilter, setAuthorFilter] = useState('all'); // 'all' | 'you' | 'athena' | personaId
  const [query, setQuery] = useState('');
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTER_PREFIX + teamId);
      const saved = raw ? (JSON.parse(raw) as { kind?: string; author?: string }) : null;
      setKindFilter(saved?.kind === 'talk' || saved?.kind === 'activity' ? saved.kind : 'all');
      setAuthorFilter(saved?.author ?? 'all');
    } catch (err) {
      silentCatch('collab/correspondence:filterLoad')(err);
    }
    setQuery('');
  }, [teamId]);
  const persistFilters = (kind: string, author: string) => {
    try {
      if (kind === 'all' && author === 'all') localStorage.removeItem(FILTER_PREFIX + teamId);
      else localStorage.setItem(FILTER_PREFIX + teamId, JSON.stringify({ kind, author }));
    } catch (err) {
      silentCatch('collab/correspondence:filterSave')(err);
    }
  };
  const updateKindFilter = (kind: 'all' | 'talk' | 'activity') => {
    setKindFilter(kind);
    persistFilters(kind, authorFilter);
  };
  const updateAuthorFilter = (author: string) => {
    setAuthorFilter(author);
    persistFilters(kindFilter, author);
  };
  // A restored author filter can point at a persona that has since left the
  // team — fall back to 'all' rather than silently filtering to nothing.
  useEffect(() => {
    if (authorFilter === 'all' || authorFilter === 'you' || authorFilter === 'athena') return;
    if (members.length > 0 && !members.some((m) => m.personaId === authorFilter)) {
      setAuthorFilter('all');
      persistFilters(kindFilter, 'all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, authorFilter]);
  const filtersActive = kindFilter !== 'all' || authorFilter !== 'all' || query.trim() !== '';
  const visible = useMemo(() => {
    if (!filtersActive) return ordered;
    const q = query.trim().toLowerCase();
    const TALK = new Set(['persona', 'athena', 'director', 'directive', 'memory']);
    return ordered.filter((i) => {
      if (kindFilter === 'talk' && !TALK.has(i.kind)) return false;
      if (kindFilter === 'activity' && i.kind !== 'step' && i.kind !== 'event') return false;
      if (authorFilter === 'you') {
        if (i.kind !== 'directive') return false;
      } else if (authorFilter === 'athena') {
        if (i.kind !== 'athena') return false;
      } else if (authorFilter !== 'all' && i.personaId !== authorFilter) {
        return false;
      }
      if (q) {
        const authorName = i.personaId ? personaIndex.get(i.personaId)?.name ?? '' : '';
        if (!`${i.body ?? ''} ${i.label} ${authorName}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [ordered, kindFilter, authorFilter, query, filtersActive, personaIndex]);
  const clearFilters = () => {
    setKindFilter('all');
    setAuthorFilter('all');
    setQuery('');
    persistFilters('all', 'all');
  };

  useEffect(() => {
    const box = scrollBox.current;
    if (box && stickBottom.current) box.scrollTop = box.scrollHeight;
  }, [ordered.length]);

  // Unseen-while-scrolled-up: remember the newest item seen while pinned to the
  // bottom; when the user scrolls up, anything past that marker counts as new.
  // findIndex (not a length delta) keeps loadOlder() prepends from inflating it.
  useEffect(() => {
    const latest = ordered[ordered.length - 1];
    if (!latest) return;
    if (stickBottom.current) {
      lastSeenIdRef.current = latest.id;
      setUnseen(0);
      return;
    }
    const idx = lastSeenIdRef.current ? ordered.findIndex((i) => i.id === lastSeenIdRef.current) : -1;
    setUnseen(idx >= 0 ? ordered.length - 1 - idx : 0);
  }, [ordered]);

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
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    stickBottom.current = near;
    setAtBottom(near);
    if (near && ordered.length > 0) {
      lastSeenIdRef.current = ordered[ordered.length - 1]!.id;
      setUnseen(0);
    }
  };

  const jumpToLatest = () => {
    const box = scrollBox.current;
    if (!box) return;
    stickBottom.current = true;
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || posting) return;
    updateDraft('');
    void sendDirective(text, replyTarget?.id);
    setReplyTarget(null);
    stickBottom.current = true;
    if (/@athena\b/i.test(text)) {
      // Tagging Athena runs her turn in the BACKGROUND (chat stays closed) and
      // tells her which team/channel this came from so she reacts by posting
      // BACK INTO the channel (companion_post_team_message), not in a chat panel.
      useCompanionStore.getState().setPendingPrompt({
        text:
          `You were tagged in a team channel (team_id: ${teamId}). The user wrote:\n\n` +
          `"${text}"\n\n` +
          `Respond by posting a short, helpful reply INTO that team's channel via your ` +
          `post_team_message capability (team_id: ${teamId}), so the team and the user see ` +
          `it in the conversation — do NOT reply only in chat. If a brief action helps, do ` +
          `it first, then post a one-line status to the channel.`,
        autoSend: true,
      });
      // Intentionally NOT opening the companion panel — Athena answers in-channel.
    }
  };

  // @-mention autocomplete: a trailing @-token matches Athena or any team
  // member (full name or first-word prefix, case-insensitive). Completing a
  // member inserts @FirstWord — directives already deliver to every member at
  // the next step boundary; the mention is the addressing affordance on top.
  const mentionCandidates = useMemo(() => {
    const m = draft.match(/(?:^|\s)@([\p{L}\d_-]{1,24})$/iu);
    if (!m) return null;
    const partial = m[1]!.toLowerCase();
    const list: { key: string; label: string; insert: string; athena?: boolean; icon?: string | null; color?: string | null }[] = [];
    if ('athena'.startsWith(partial)) list.push({ key: 'athena', label: '@athena', insert: '@athena ', athena: true });
    for (const mem of members) {
      const name = mem.name.replace(/^T: /, '');
      const slug = name.split(/\s+/)[0]!;
      if (name.toLowerCase().startsWith(partial) || slug.toLowerCase().startsWith(partial)) {
        list.push({ key: mem.memberId, label: `@${name}`, insert: `@${slug} `, icon: mem.icon, color: mem.color });
      }
    }
    return list.length > 0 ? list.slice(0, 4) : null;
  }, [draft, members]);
  const completeMention = (insert: string) => {
    updateDraft((d) => d.replace(/(^|\s)@([\p{L}\d_-]{1,24})$/iu, (_full, pre: string) => `${pre}${insert}`));
  };

  // Pin a channel item into the team's long-term memory. The channel
  // read-model unions memories back in, so the pin reappears as a memory row
  // on the next head refresh — visible confirmation where the action happened.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  useEffect(() => setPinnedIds(new Set()), [teamId]);
  const pinItem = async (item: TeamChannelItem) => {
    const body = (item.body ?? '').trim();
    const firstLine = body.split('\n')[0] ?? '';
    const title = (firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine) || item.label;
    try {
      await createTeamMemory({
        team_id: teamId,
        run_id: null,
        member_id: null,
        persona_id: item.personaId,
        title,
        content: body || item.label,
        category: 'observation',
        importance: 5,
        tags: JSON.stringify({ source: 'channel_pin', item_id: item.id }),
      });
      setPinnedIds((prev) => new Set(prev).add(item.id));
      addToast(t.monitor.channel_pinned_memory, 'success');
      refreshHead();
    } catch (err) {
      silentCatch('collab/correspondence:pinMemory')(err);
      addToast(t.monitor.channel_pin_failed, 'error');
    }
  };

  const workingNames = members
    .filter((m) => presence.get(m.personaId) === 'working')
    .map((m) => m.name.replace(/^T: /, ''));
  const reviewCount = members.filter((m) => presence.get(m.personaId) === 'waiting').length;

  // The header crest wears the team's identity (icon + color, editable in
  // Workspace settings) instead of a generic red radio glyph.
  const team = usePipelineStore((s) => s.teams.find((x) => x.id === teamId)) ?? null;
  const crestAccent = team?.color ?? '#f87171';

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* ── Header band: identity · live presence · data glance ── */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015] px-4 py-3 flex items-center gap-3">
        <div
          className="relative w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${crestAccent}26`, borderColor: `${crestAccent}59` }}
        >
          {team?.icon ? (
            <span aria-hidden className="typo-body leading-none">{team.icon}</span>
          ) : (
            <Radio className="w-4 h-4" style={{ color: crestAccent }} />
          )}
        </div>
        <div className="min-w-0">
          <div className="typo-body-lg font-semibold text-foreground leading-tight truncate">{teamName ?? 'Team channel'}</div>
          <div className="typo-caption text-foreground leading-tight truncate">
            {workingNames.length > 0 ? `${workingNames.slice(0, 3).join(', ')} working…` : `${members.length} members`}
          </div>
        </div>
        <div className="flex-1" />
        {/* Live presence */}
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
                {st && (
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background ${st === 'working' ? 'bg-status-info' : 'bg-status-warning'}`} />
                )}
              </span>
            );
          })}
        </div>
        {/* Data glance */}
        <div className="flex items-center gap-3.5 typo-data text-foreground tabular-nums pl-2 border-l border-border ml-1">
          <span className="flex items-center gap-1.5" title="Transmissions">
            <Activity className="w-4 h-4 text-foreground" /> {items.length}
          </span>
          {workingNames.length > 0 && <span className="text-status-info">{workingNames.length} working</span>}
          {reviewCount > 0 && (
            <span className="text-status-warning flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> {reviewCount}
            </span>
          )}
        </div>
      </div>

      {/* ── Filter bar: text search · kind · author ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-foreground/[0.01]">
        <div className="relative flex-1 min-w-0 max-w-[240px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.monitor.channel_filter_search}
            className="w-full pl-7 pr-2 py-1 rounded-input bg-secondary/30 border border-border typo-caption text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-input border border-border bg-secondary/20 p-0.5">
          {([
            ['all', t.monitor.channels_filter_all],
            ['talk', t.monitor.channel_filter_talk],
            ['activity', t.monitor.channel_filter_activity],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => updateKindFilter(k)}
              aria-pressed={kindFilter === k}
              className={`px-2 py-0.5 rounded-interactive typo-caption transition-colors ${
                kindFilter === k ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/55 hover:text-foreground/85'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <ThemedSelect value={authorFilter} onValueChange={updateAuthorFilter} className="w-32">
          <option value="all">{t.monitor.channels_author_all}</option>
          <option value="you">{t.monitor.channels_author_you}</option>
          <option value="athena">{t.monitor.channels_author_athena}</option>
          {members.map((m) => (
            <option key={m.memberId} value={m.personaId}>{m.name.replace(/^T: /, '')}</option>
          ))}
        </ThemedSelect>
        {filtersActive && (
          <>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-primary transition-colors flex-shrink-0"
            >
              <X className="w-3 h-3" /> {t.monitor.channel_filter_clear}
            </button>
            <span className="ml-auto typo-caption text-foreground tabular-nums flex-shrink-0">
              {visible.length}/{ordered.length}
            </span>
          </>
        )}
      </div>

      {/* ── Conversation ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={scrollBox} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1">
          {/* Pending manual reviews (Director coaching / triage) for this team's
              personas — the quick-answer card, cross-referenced into the channel. */}
          <PendingReviewTray memberIds={memberIds} personaIndex={personaIndex} />
          {!exhausted && ordered.length > 0 && (
            <div ref={topSentinel} className="py-1 text-center">
              <span className="typo-caption text-foreground">{t.monitor.channel_loading_history}</span>
            </div>
          )}
          {exhausted && ordered.length > 0 && <p className="py-1 text-center typo-caption text-foreground">{t.monitor.channel_start_of_conversation}</p>}
          {!loaded && <p className="typo-body text-foreground py-3">{t.monitor.channel_tuning_in}</p>}
          {loaded && ordered.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-14 px-6">
              <div className="relative flex items-center justify-center mb-4" style={{ width: 96, height: 96 }}>
                <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(248,113,113,0.14), transparent 70%)' }} />
                <div className="relative w-14 h-14 rounded-full bg-status-error/12 border border-status-error/20 flex items-center justify-center">
                  <Radio className="w-7 h-7 text-status-error/80" />
                </div>
              </div>
              <h3 className="typo-section-title text-foreground">{t.monitor.channel_empty_title}</h3>
              <p className="typo-body text-foreground mt-1.5 max-w-sm">{t.monitor.channel_empty_body}</p>
              <div className="mt-3 flex flex-col gap-1.5 typo-caption text-foreground">
                <span className="inline-flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-status-success" /> {t.monitor.channel_empty_directive_hint}</span>
                {/* "@athena" is the literal tag users type — not translatable. */}
                {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
                <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-300" /> {t.monitor.channel_empty_athena_before} <span className="text-violet-300 font-medium">@athena</span> {t.monitor.channel_empty_athena_after}</span>
              </div>
            </div>
          )}
          {filtersActive && visible.length === 0 && ordered.length > 0 && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <p className="typo-body text-foreground">{t.monitor.channel_filter_no_matches}</p>
              <button type="button" onClick={clearFilters} className="typo-caption text-primary hover:underline">
                {t.monitor.channel_filter_clear}
              </button>
            </div>
          )}
          {visible.map((item) => (
            <CorrespondenceRow
              key={item.id}
              item={item}
              personaIndex={personaIndex}
              members={members}
              parent={item.replyTo ? byId.get(item.replyTo) : undefined}
              onReply={() => setReplyTarget(item)}
              onOpenDetail={() => setDetailItem(item)}
              onPin={() => void pinItem(item)}
              pinned={pinnedIds.has(item.id)}
            />
          ))}
        </div>
        {/* Jump-to-latest pill — appears when scrolled away from the live edge;
            carries the unseen count when new messages land while reading history. */}
        <AnimatePresence>
          {!atBottom && loaded && ordered.length > 0 && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.16 }}
              onClick={jumpToLatest}
              className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-elevation-2 backdrop-blur-sm typo-caption transition-colors ${
                unseen > 0
                  ? 'border-status-info/40 bg-status-info/15 text-status-info hover:bg-status-info/25'
                  : 'border-border bg-secondary/80 text-foreground hover:bg-secondary'
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {unseen > 0
                ? (unseen === 1 ? t.monitor.channel_new_messages_one : tx(t.monitor.channel_new_messages_other, { count: unseen }))
                : t.monitor.channel_jump_latest}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 flex flex-col gap-1.5 px-3 py-3 border-t border-border bg-foreground/[0.015]">
        {replyTarget && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-primary/20 bg-primary/5">
            <CornerDownRight className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
            {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
            <span className="typo-caption text-foreground flex-shrink-0">Replying to</span>
            <span className="typo-caption font-medium" style={{ color: itemAccent(replyTarget, replyTarget.personaId ? personaIndex.get(replyTarget.personaId) : undefined) }}>
              {authorName(replyTarget, replyTarget.personaId ? personaIndex.get(replyTarget.personaId) : undefined)}
            </span>
            <span className="typo-caption text-foreground truncate">{replyTarget.body ?? replyTarget.label}</span>
            {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
            <button type="button" onClick={() => setReplyTarget(null)} className="ml-auto flex-shrink-0 text-foreground hover:text-foreground/80 transition-colors" aria-label="Cancel reply">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {mentionCandidates && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {mentionCandidates.map((c, idx) => (
              <button
                key={c.key}
                type="button"
                onClick={() => completeMention(c.insert)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-card border typo-caption transition-colors ${
                  c.athena
                    ? 'border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20'
                    : 'border-border bg-secondary/30 text-foreground hover:bg-secondary/50'
                }`}
              >
                {c.athena ? (
                  <Sparkles className="w-3.5 h-3.5" />
                ) : (
                  <PersonaIcon icon={c.icon ?? null} color={c.color ?? null} size="w-3.5 h-3.5" />
                )}
                {c.label}
                {idx === 0 && <span className="text-foreground">— {t.monitor.channel_mention_tab}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
        <textarea
          ref={composerRef}
          value={draft}
          rows={1}
          onChange={(e) => updateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && mentionCandidates) { e.preventDefault(); completeMention(mentionCandidates[0]!.insert); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={replyTarget ? t.monitor.channel_composer_reply_placeholder : t.monitor.channels_composer_placeholder}
          title={t.monitor.channel_composer_newline_hint}
          className="flex-1 resize-none max-h-40 overflow-y-auto px-3.5 py-2.5 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
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

      <ChannelDetailModal
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onPin={(it) => void pinItem(it)}
        pinned={detailItem ? pinnedIds.has(detailItem.id) : false}
      />
    </div>
  );
}

/**
 * Resolve a channel item into the uniform two-row shape: SOURCE + EVENT for
 * row 1, MESSAGE for row 2. Keeps the per-kind vocabulary in one place so the
 * row layout below stays a single structure for every author kind.
 */
function resolveRow(item: TeamChannelItem) {
  let event = item.label;
  let eventTone = 'text-foreground/50';
  let eventMono = false;
  let message: string | null = item.body;
  let artifact: { url: string; label: string } | null = null;
  let isError = false;
  let alert = false;

  if (item.kind === 'step') {
    event = STEP_VERB[item.label] ?? item.label;
    eventTone = STEP_TONE[item.label] ?? 'text-foreground/55';
    isError = item.label === 'step_failed';
    alert = item.label === 'status_awaiting_review' || isError;
  } else if (item.kind === 'event') {
    const parsed = payloadSummary(item.extra);
    message = parsed.summary;
    artifact = parsed.artifact;
    eventTone = FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!;
    eventMono = true;
  } else if (item.kind === 'memory') {
    event = `memory · ${item.label}`;
    eventTone = 'text-amber-300/80';
  } else if (item.kind === 'directive') {
    event = 'directive';
    eventTone = 'text-status-success';
  } else if (item.kind === 'persona' || item.kind === 'athena' || item.kind === 'director') {
    const meta = AUTHOR_KIND_META[item.kind];
    event = meta.label;
    eventTone = meta.tag;
  }
  return { event, eventTone, eventMono, message, artifact, isError, alert };
}

/**
 * Uniform two-row message row.
 *   Row 1 (SOURCE + EVENT): sigil · author name (in their colour) · event chip · time
 *   Row 2 (MESSAGE): the body, in an accent-tinted container indented under the source
 * A "Needs your review" row carries the inline ReviewInterventionCard below.
 */
function CorrespondenceRow({ item, personaIndex, members, parent, onReply, onOpenDetail, onPin, pinned }: {
  item: TeamChannelItem;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  members?: ChannelMember[];
  parent?: TeamChannelItem;
  onReply?: () => void;
  onOpenDetail?: () => void;
  onPin?: () => void;
  pinned?: boolean;
}) {
  const { t } = useTranslation();
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const source = authorName(item, persona);
  const { event, eventTone, eventMono, message, artifact, isError, alert } = resolveRow(item);

  const isUser = item.kind === 'directive';
  const isAgentVoice = item.kind === 'athena' || item.kind === 'director';
  // System activity (the step layer + bus events) reads as a distinct compact
  // ALERT strip, visually separate from the human/agent conversation bubbles.
  const isSystem = item.kind === 'step' || item.kind === 'event';
  const intervene = item.kind === 'step' && item.label === 'status_awaiting_review' && !!item.assignmentId;
  // A message you can reply to — the conversational kinds (not raw step/event rows).
  const replyable = !!onReply && (item.kind === 'persona' || item.kind === 'athena' || item.kind === 'director' || item.kind === 'directive' || item.kind === 'memory');
  // Pinnable: anything worth keeping except rows that already ARE memories.
  // System rows pin from the detail modal (their strip is a single button).
  const pinnable = !!onPin && item.kind !== 'memory' && !isSystem;
  const isReply = !!item.replyTo;
  const parentPersona = parent?.personaId ? personaIndex.get(parent.personaId) : undefined;

  const deliveries = isUser ? parseDeliveries(item) : [];
  const seenIds = [...new Set(deliveries.map((d) => d.persona_id))];
  // Members addressed via @FirstWord in this directive — surfaced as chips so
  // the author sees who the message was aimed at.
  const mentioned = isUser && members
    ? members.filter((m) => {
        const slug = m.name.replace(/^T: /, '').split(/\s+/)[0]!;
        const safe = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`@${safe}(?![\\p{L}\\d_-])`, 'iu').test(item.body ?? '');
      })
    : [];

  // Row-2 container tint: tinted for human/agent voices, subtle for system rows.
  let bodyClass = 'border-primary/12 bg-secondary/15';
  if (isUser) bodyClass = 'border-status-success/25 bg-status-success/10';
  else if (item.kind === 'athena') bodyClass = AUTHOR_KIND_META.athena.bubble;
  else if (item.kind === 'director') bodyClass = AUTHOR_KIND_META.director.bubble;
  else if (item.kind === 'memory') bodyClass = 'border-amber-500/20 bg-amber-500/5';

  // Row-1 sigil.
  const sigil =
    item.kind === 'memory' ? (
      <Pin className="w-3.5 h-3.5 text-amber-300/80" />
    ) : isAgentVoice ? (
      (() => { const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director']; return <M.Icon className={`w-3.5 h-3.5 ${M.iconColor}`} />; })()
    ) : persona ? (
      <PersonaIcon icon={persona.icon} color={persona.color} size="w-3.5 h-3.5" />
    ) : (
      <span className="typo-caption text-foreground">·</span>
    );

  // ── System activity: a distinct compact alert strip (step layer + bus) ──
  // Click opens the full decomposed detail; the strip itself stays a one-line
  // key-metadata summary so the conversation isn't drowned in machine output.
  if (isSystem) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.14 }} className="group py-0.5">
        <button
          type="button"
          onClick={onOpenDetail}
          className={`w-full text-left flex items-center gap-2 rounded-card border px-2.5 py-1.5 transition-colors ${alert ? 'border-status-warning/30 bg-status-warning/[0.06] hover:bg-status-warning/[0.1]' : 'border-border/50 bg-foreground/[0.02] hover:bg-foreground/[0.04]'}`}
        >
          {alert ? (
            <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
          )}
          <span className="typo-caption font-medium flex-shrink-0" style={{ color: accent }}>{source}</span>
          <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${eventMono ? 'font-mono normal-case tracking-normal' : ''} ${eventTone}`}>{event}</span>
          {message && <span className={`typo-caption truncate ${isError ? 'text-status-error/80' : 'text-foreground'}`}>{message}</span>}
          {artifact && (
            <a href={artifact.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 typo-caption text-status-info hover:underline flex-shrink-0">
              <ExternalLink className="w-3 h-3" /> {artifact.label}
            </a>
          )}
          <span className="ml-auto typo-caption text-foreground flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
        </button>
        {intervene && item.assignmentId && (
          <div className="ml-2 mt-1"><ReviewInterventionCard assignmentId={item.assignmentId} personaIndex={personaIndex} /></div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className={`group py-1 ${isReply ? 'ml-5 pl-3 border-l-2 border-primary/15' : ''}`}>
      {/* Reply reference — the message this one threads under */}
      {isReply && parent && (
        <div className="flex items-center gap-1.5 mb-0.5 typo-caption text-foreground">
          <CornerDownRight className="w-3 h-3 flex-shrink-0" />
          <span className="font-medium" style={{ color: itemAccent(parent, parentPersona) }}>{authorName(parent, parentPersona)}</span>
          <span className="truncate">{parent.body ?? parent.label}</span>
        </div>
      )}
      {/* Row 1 — SOURCE + EVENT */}
      <div className="flex items-center gap-2 flex-wrap leading-tight">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary/70 border flex-shrink-0"
          style={{ borderColor: accent }}
        >
          {sigil}
        </span>
        <span className="typo-body font-medium" style={{ color: accent }}>{source}</span>
        {alert && <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />}
        <span className={`typo-caption uppercase tracking-wider ${eventMono ? 'font-mono normal-case tracking-normal' : ''} ${eventTone}`}>{event}</span>
        {replyable && (
          <button
            type="button"
            onClick={onReply}
            className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground/80 transition-all"
            aria-label="Reply"
          >
            <Reply className="w-3 h-3" /> reply
          </button>
        )}
        {pinnable && (
          <button
            type="button"
            onClick={pinned ? undefined : onPin}
            disabled={pinned}
            className={`inline-flex items-center gap-1 typo-caption transition-all ${
              pinned
                ? 'text-amber-300/90 opacity-100'
                : 'opacity-0 group-hover:opacity-100 text-foreground hover:text-amber-300/90'
            }`}
            aria-label={pinned ? t.monitor.channel_pinned_memory : t.monitor.channel_pin_memory}
            title={pinned ? t.monitor.channel_pinned_memory : t.monitor.channel_pin_memory}
          >
            <Pin className="w-3 h-3" />
          </button>
        )}
        <span className="ml-auto typo-caption text-foreground flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
      </div>

      {/* Row 2 — MESSAGE */}
      {(message || artifact || isUser || intervene) && (
        <div className="mt-1 ml-8">
          {(message || artifact || isUser) && (
            <div
              className={`rounded-card border px-3 py-2 ${bodyClass} ${!isUser && onOpenDetail ? 'cursor-pointer hover:border-primary/25' : ''}`}
              onClick={!isUser ? onOpenDetail : undefined}
              title={!isUser && onOpenDetail ? 'Open full detail' : undefined}
            >
              {message && (
                <p className={`typo-body whitespace-pre-wrap ${!isUser ? 'line-clamp-4' : ''} ${isError ? 'text-status-error/90' : 'text-foreground/85'}`}>{message}</p>
              )}
              {artifact && (
                <a href={artifact.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-border typo-caption text-status-info hover:bg-secondary/60 transition-colors">
                  <ExternalLink className="w-3 h-3" /> {artifact.label}
                </a>
              )}
              {isUser && (
                <p className="mt-1 inline-flex items-center gap-1.5 typo-caption text-foreground flex-wrap">
                  {seenIds.length > 0 ? (
                    /* eslint-disable-next-line custom/no-hardcoded-jsx-text */
                    <><CheckCheck className="w-3.5 h-3.5 text-status-success" /> seen by {seenIds.slice(0, 3).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)}{seenIds.length > 3 && <span>+{seenIds.length - 3}</span>}</>
                  ) : (
                    /* eslint-disable-next-line custom/no-hardcoded-jsx-text */
                    <><Check className="w-3.5 h-3.5" /> delivered at next step boundary</>
                  )}
                  {/@athena\b/i.test(item.body ?? '') && (
                    <span className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-interactive bg-violet-500/10 border border-violet-500/25 text-violet-300">
                      {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
                      <Sparkles className="w-3 h-3" /> Athena notified
                    </span>
                  )}
                  {mentioned.map((m) => (
                    <span
                      key={m.memberId}
                      title={t.monitor.channel_mention_will_see}
                      className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-border"
                    >
                      <PersonaIcon icon={m.icon} color={m.color} size="w-3 h-3" />
                      <span className="typo-caption" style={{ color: m.color ?? undefined }}>
                        @{m.name.replace(/^T: /, '').split(/\s+/)[0]}
                      </span>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
          {intervene && item.assignmentId && (
            <ReviewInterventionCard assignmentId={item.assignmentId} personaIndex={personaIndex} />
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Inline team-review intervention — the cross-reference for a "Needs your
 * review" channel row. Resolves the assignment's awaiting-review (or failed)
 * step in place via the team-review path (skip / abort / edit-and-retry),
 * mirroring the Flight Deck StepRelay actions so the user never leaves the
 * conversation. (Team step reviews use `resolveTeamAssignmentReview`, distinct
 * from the manual-review approve/reject path that `PendingReviewTray` wires.)
 */
function ReviewInterventionCard({
  assignmentId,
  personaIndex,
}: {
  assignmentId: string;
  personaIndex: ReturnType<typeof usePersonaIndex>;
}) {
  const { steps, refresh } = useAssignmentSteps(assignmentId, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const step = steps.find((s) => s.status === 'awaiting_review') ?? steps.find((s) => s.status === 'failed');
  if (!step) return null;
  const persona = step.assignedPersonaId ? personaIndex.get(step.assignedPersonaId) : undefined;

  const act = async (kind: 'skip' | 'abort' | 'edit') => {
    setBusy(kind);
    try {
      if (kind === 'edit') {
        await resolveTeamAssignmentReview(step.id, { action: 'edit_requirement', data: { description: note.trim() } });
      } else {
        await resolveTeamAssignmentReview(step.id, { action: kind });
      }
      setNote('');
      refresh();
    } catch (err) {
      silentCatch('collab/correspondence:reviewIntervention')(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-1 rounded-card border border-status-warning/30 bg-status-warning/5 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <ClipboardCheck className="w-4 h-4 text-status-warning flex-shrink-0" />
        <span className="typo-body font-semibold text-foreground truncate min-w-0">{step.title}</span>
        <PersonaChip persona={persona} />
      </div>
      {step.errorMessage && (
        <p className="typo-caption text-status-error/90 leading-snug">{step.errorMessage}</p>
      )}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        // eslint-disable-next-line custom/no-hardcoded-jsx-text
        placeholder="Optional: revise the requirement, then Edit & retry…"
        className="px-3 py-1.5 rounded-input bg-primary/5 border border-card-border typo-caption text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
      />
      <div className="flex items-center gap-1.5 self-end flex-wrap">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void act('skip')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-card-border bg-secondary/40 typo-caption text-foreground/85 hover:bg-secondary/60 transition-colors disabled:opacity-50"
        >
          <SkipForward className="w-3 h-3" /> Skip
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void act('abort')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-status-error/25 bg-status-error/10 typo-caption text-status-error hover:bg-status-error/20 transition-colors disabled:opacity-50"
        >
          <Ban className="w-3 h-3" /> Abort
        </button>
        <button
          type="button"
          disabled={!!busy || !note.trim()}
          onClick={() => void act('edit')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/30 bg-primary/10 typo-caption text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
        >
          {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
          <RotateCcw className="w-3 h-3" /> Edit &amp; retry
        </button>
      </div>
    </div>
  );
}

/**
 * Lightweight team-scoped pending-review feed. Deliberately does NOT reuse
 * `usePendingInteractions`/`useMonitorData` (which also poll persona summaries
 * + messages on the dashboard cadence) — an always-on channel surface
 * shouldn't carry that load. Polls only `list_manual_reviews(pending)` on a
 * gentle interval, filters to team members, and joins persona display info
 * from the channel's persona index. Resolves via `update_manual_review_status`.
 */
function useTeamPendingReviews(memberIds: Set<string>, personaIndex: ReturnType<typeof usePersonaIndex>) {
  const [reviews, setReviews] = useState<ManualReviewItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useMemo(
    () => () => {
      listManualReviews(undefined, 'pending')
        .then((rows) => {
          const mapped = rows
            .filter((r) => memberIds.has(r.persona_id))
            .map((r): ManualReviewItem => {
              const p = personaIndex.get(r.persona_id);
              return {
                id: r.id,
                persona_id: r.persona_id,
                execution_id: r.execution_id,
                review_type: '',
                content: r.description ?? '',
                severity: r.severity,
                status: r.status,
                reviewer_notes: r.reviewer_notes,
                context_data: r.context_data,
                suggested_actions: r.suggested_actions,
                title: r.title,
                created_at: r.created_at,
                resolved_at: r.resolved_at,
                persona_name: p?.name?.replace(/^T: /, '') ?? undefined,
                persona_icon: p?.icon ?? undefined,
                persona_color: p?.color ?? undefined,
              };
            });
          setReviews(mapped);
        })
        .catch(silentCatch('collab/correspondence:pendingReviews'));
    },
    [memberIds, personaIndex],
  );

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onAction = async (id: string, status: ManualReviewStatus, notes?: string) => {
    setBusy(true);
    try {
      await updateManualReviewStatus(id, status, notes);
      setReviews((prev) => prev.filter((r) => r.id !== id)); // optimistic
    } catch (err) {
      silentCatch('collab/correspondence:resolveReview')(err);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return { reviews, busy, onAction };
}

/**
 * Pending manual reviews (Director coaching / auto-triage) for this team's
 * personas, surfaced as the shared QuickAnswerReviewCard — the same approve/
 * reject component the title-bar quick-answer popover uses. This is the
 * cross-reference into the channel: a review raised against any team member
 * becomes actionable here, where the team is talking.
 */
function PendingReviewTray({ memberIds, personaIndex }: { memberIds: Set<string>; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const { reviews: teamReviews, busy, onAction } = useTeamPendingReviews(memberIds, personaIndex);
  if (teamReviews.length === 0) return null;
  return (
    <div className="mb-2 pb-2 border-b border-border space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <ClipboardCheck className="w-3.5 h-3.5 text-status-warning" />
        {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
        <span className="typo-label uppercase tracking-[0.18em] text-status-warning/80 font-semibold">Needs your input</span>
        <span className="ml-auto typo-caption text-foreground tabular-nums">{teamReviews.length}</span>
      </div>
      <AnimatePresence initial={false}>
        {teamReviews.map((r) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <QuickAnswerReviewCard review={r} busy={busy} onAction={onAction} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default CollabLiveCorrespondence;
