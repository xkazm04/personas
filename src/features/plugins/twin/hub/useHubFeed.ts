/**
 * useHubFeed — ONE load for everything the Hub shows, and every reaction
 * available on a row. Implements `HubFeedApi` from `./hubContract`.
 *
 * Why it does not read `twinPendingMemories` from the store: that slice holds
 * the LAST filter a panel asked for (twinSlice.ts:505), so whichever tab ran
 * last decides what every other reader sees — which is why the Hub's pending /
 * approved / rejected counts read 0 whenever the previous surface filtered.
 * This hook fetches all three statuses itself and keeps all three.
 *
 * Governing rules: a rejection SUPERSEDES rather than deletes (the row stays in
 * the feed carrying its reason), `loading` / `error` are DERIVED from one
 * snapshot rather than hand-maintained flags, and `busyId` is the key of the
 * row that was pressed so one press never lights a sibling's spinner.
 */

import { createLatestWins } from '@/stores/util/latestWins';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { extractMessage, silentCatch, toastCatch } from '@/lib/silentCatch';
import * as twinApi from '@/api/twin/twin';
import { createKnowledgeBase, getKnowledgeBase, listKnowledgeBases } from '@/api/vault/database/vectorKb';
import type { KnowledgeBase } from '@/lib/bindings/KnowledgeBase';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';
import type { TwinContact } from '@/lib/bindings/TwinContact';
import type { TwinDistilledFact } from '@/lib/bindings/TwinDistilledFact';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { TwinReflection } from '@/lib/bindings/TwinReflection';
import type { TwinWikiStatus } from '@/lib/bindings/TwinWikiStatus';
import type {
  HubCounts, HubEntry, HubFeedApi, HubRejectReason, HubReviewStatus, HubSources,
} from './hubContract';

/** Newest N communications. The river caps what it RENDERS separately. */
const COMMUNICATION_LIMIT = 200;
/** Same cap for pending/approved/rejected memories — Hub is a desk, not a dump. */
const MEMORY_LIMIT = 200;
/** Reviewer note a dig-deeper approval files, unchanged from the 2026 inbox. */
const DIG_DEEPER_NOTE = 'dig_deeper';
/** Busy keys for the sources strip — never an entry id, so they cannot collide. */
export const HUB_BUSY = {
  kb: 'source:kb', wiki: 'source:wiki', audit: 'source:audit',
  doctrine: 'source:doctrine', reflect: 'source:reflect',
} as const;

interface Snapshot {
  memories: TwinPendingMemory[];
  comms: TwinCommunication[];
  facts: TwinDistilledFact[];
  reflections: TwinReflection[];
  contacts: TwinContact[];
  kb: KnowledgeBase | null;
  wiki: TwinWikiStatus | null;
}

function emptySnap(): Snapshot {
  return {
    memories: [], comms: [], facts: [], reflections: [], contacts: [], kb: null, wiki: null,
  };
}

function mergeMemories(
  prev: TwinPendingMemory[],
  incoming: TwinPendingMemory[],
  status: string,
): TwinPendingMemory[] {
  return [...prev.filter((m) => m.status !== status), ...incoming];
}

/** The contract plus the two things the sources strip needs and it does not name. */
export interface HubFeed extends HubFeedApi {
  twinId: string | null;
  twinName: string | null;
  knowledgeBases: KnowledgeBase[];
  loadKnowledgeBases: () => Promise<void>;
  createBoundKnowledgeBase: () => Promise<void>;
}

/** A read that is allowed to be absent (no wiki yet, KB row gone) without failing the load. */
function soft<T>(p: Promise<T>, tag: string): Promise<T | null> {
  return p.catch((err: unknown) => { silentCatch(tag)(err); return null; });
}

const HUB_LANE_COUNT = 9;

function reviewStatus(raw: string): HubReviewStatus {
  return raw === 'approved' ? 'approved' : raw === 'rejected' ? 'rejected' : 'pending';
}

/** One row → one entry. The kind token drives glyph + colour; it is never typed. */
function toEntries(s: Snapshot): HubEntry[] {
  const out: HubEntry[] = [
    ...s.memories.map((row): HubEntry => ({
      id: row.id, kind: row.channel === 'audit' ? 'audit' : 'memory', at: row.created_at,
      channel: row.channel, title: row.title, body: row.content, status: reviewStatus(row.status),
      reviewerNotes: row.reviewer_notes, contactHandle: null, importance: row.importance,
      source: { kind: 'memory', row },
    })),
    ...s.comms.map((row): HubEntry => ({
      id: row.id, kind: 'message', at: row.occurred_at, channel: row.channel, title: row.summary,
      body: row.content, status: null, reviewerNotes: null, contactHandle: row.contact_handle,
      importance: null, source: { kind: 'message', row },
    })),
    ...s.facts.map((row): HubEntry => ({
      id: row.id, kind: 'fact', at: row.created_at, channel: null, title: null, body: row.content,
      status: null, reviewerNotes: null, contactHandle: row.contact_handle, importance: row.importance,
      source: { kind: 'fact', row },
    })),
    ...s.reflections.map((row): HubEntry => ({
      id: row.id, kind: 'reflection', at: row.created_at, channel: null, title: row.prompt_seed,
      body: row.content, status: null, reviewerNotes: null, contactHandle: null, importance: null,
      source: { kind: 'reflection', row },
    })),
  ];
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A fact needs provenance; the repo rejects an empty source list at the write boundary. */
function provenanceOf(entry: HubEntry): string[] {
  if (entry.source.kind === 'message') return [entry.source.row.id];
  if (entry.source.kind === 'memory' && entry.source.row.source_communication_id) {
    return [entry.source.row.source_communication_id];
  }
  return [];
}

export function useHubFeed(): HubFeed {
  const t = useTranslation().t.twin.hub;
  const addToast = useToastStore((s) => s.addToast);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const fetchReadinessApproved = useSystemStore((s) => s.fetchTwinReadinessApproved);
  const bindKb = useSystemStore((s) => s.bindTwinKnowledgeBase);
  const unbindKb = useSystemStore((s) => s.unbindTwinKnowledgeBase);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);

  const activeTwin = twinProfiles.find((p) => p.id === activeTwinId) ?? null;
  const twinId = activeTwinId;
  const kbId = activeTwin?.knowledge_base_id ?? null;

  const [load, setLoad] = useState<{ snap: Snapshot | null; error: string | null; pending: number }>({
    snap: null, error: null, pending: 0,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  // One latest-wins slot per hook instance: a refresh racing an older one drops the stale write.
  const [latestWins] = useState(createLatestWins);

  const refresh = useCallback(async () => {
    if (!twinId) { setLoad({ snap: null, error: null, pending: 0 }); return; }
    const gen = latestWins.next();
    setLoad((prev) => ({ snap: prev.snap, error: null, pending: HUB_LANE_COUNT }));

    const patch = (fn: (s: Snapshot) => Snapshot) => {
      if (!latestWins.isCurrent(gen)) return;
      setLoad((prev) => ({
        snap: fn(prev.snap ?? emptySnap()),
        error: prev.error,
        pending: Math.max(0, prev.pending - 1),
      }));
    };
    const failSoft = (tag: string) => (err: unknown) => {
      silentCatch(tag)(err);
      patch((s) => s);
    };

    // Each lane patches the snapshot as it lands (Queue paints from pending
    // memories without waiting on wiki/KB). allSettled keeps refresh() honest
    // for callers that await it (ingestDoctrine).
    await Promise.allSettled([
      twinApi.listPendingMemories(twinId, 'pending', MEMORY_LIMIT)
        .then((rows) => patch((s) => ({ ...s, memories: mergeMemories(s.memories, rows, 'pending') })))
        .catch((err) => {
          silentCatch('twin:hub:load')(err);
          if (latestWins.isCurrent(gen)) {
            setLoad((prev) => ({
              snap: prev.snap,
              error: extractMessage(err),
              pending: Math.max(0, prev.pending - 1),
            }));
          }
        }),
      twinApi.listPendingMemories(twinId, 'approved', MEMORY_LIMIT)
        .then((rows) => patch((s) => ({ ...s, memories: mergeMemories(s.memories, rows, 'approved') })))
        .catch(failSoft('twin:hub:approved')),
      twinApi.listPendingMemories(twinId, 'rejected', MEMORY_LIMIT)
        .then((rows) => patch((s) => ({ ...s, memories: mergeMemories(s.memories, rows, 'rejected') })))
        .catch(failSoft('twin:hub:rejected')),
      twinApi.listCommunications(twinId, undefined, COMMUNICATION_LIMIT)
        .then((comms) => patch((s) => ({ ...s, comms })))
        .catch(failSoft('twin:hub:comms')),
      twinApi.listDistilledFacts(twinId)
        .then((facts) => patch((s) => ({ ...s, facts })))
        .catch(failSoft('twin:hub:facts')),
      twinApi.listTwinReflections(twinId)
        .then((reflections) => patch((s) => ({ ...s, reflections })))
        .catch(failSoft('twin:hub:reflections')),
      twinApi.listTwinContacts(twinId)
        .then((contacts) => patch((s) => ({ ...s, contacts })))
        .catch(failSoft('twin:hub:contacts')),
      soft(twinApi.wikiStatus(twinId), 'twin:hub:wikiStatus')
        .then((wiki) => patch((s) => ({ ...s, wiki }))),
      (kbId ? soft(getKnowledgeBase(kbId), 'twin:hub:kb') : Promise.resolve(null))
        .then((kb) => patch((s) => ({ ...s, kb }))),
    ]);
  }, [twinId, kbId, latestWins]);

  useEffect(() => { setLoad({ snap: null, error: null, pending: 0 }); void refresh(); }, [refresh]);

  const patch = useCallback((fn: (s: Snapshot) => Snapshot) => {
    setLoad((prev) => (prev.snap ? { ...prev, snap: fn(prev.snap), error: null } : prev));
  }, []);

  /** Scope the busy state to the key that was pressed, and only clear our own. */
  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusyId(key);
    try { await fn(); } catch (err) { toastCatch(`twin:hub:${key}`)(err); }
    finally { setBusyId((cur) => (cur === key ? null : cur)); }
  }, []);

  const review = useCallback(async (entry: HubEntry, approved: boolean, notes?: string) => {
    const updated = await twinApi.reviewMemory(entry.id, approved, notes);
    // The row STAYS — a verdict supersedes it, it never removes it.
    patch((s) => ({ ...s, memories: s.memories.map((m) => (m.id === entry.id ? updated : m)) }));
    if (twinId) void Promise.resolve(fetchReadinessApproved(twinId)).catch(silentCatch('twin:hub:readiness'));
  }, [patch, twinId, fetchReadinessApproved]);

  const approve = useCallback((e: HubEntry) => run(e.id, () => review(e, true)), [run, review]);

  const reject = useCallback(
    (e: HubEntry, reason: HubRejectReason) => run(e.id, () => review(e, false, reason)),
    [run, review],
  );

  const digDeeper = useCallback((entry: HubEntry) => run(entry.id, async () => {
    if (!twinId || !activeTwin) return;
    const seed = entry.title ? `${entry.title} — ${entry.body}` : entry.body;
    const raw = await twinApi.generateBio(
      activeTwin.name, activeTwin.role ?? null,
      `Below is a memory about ${activeTwin.name}${activeTwin.role ? ` (${activeTwin.role})` : ''}. Generate exactly 2 specific, conversational interview questions that would help them elaborate on what it captures — angles a thoughtful interviewer would explore next, never re-asking what the memory already says.\n\nOutput ONLY the 2 questions, one per line, numbered 1-2. No preamble.\n\nMemory: ${seed}`,
    );
    const questions = raw.split('\n')
      .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter((l) => l.length > 8)
      .slice(0, 2);
    if (questions.length === 0) throw new Error(t.errors.digDeeperEmpty);
    await review(entry, true, DIG_DEEPER_NOTE);
    setPendingTrainingQuestions(questions);
    addToast(t.toasts.digDeeperQueued, 'success');
  }), [run, twinId, activeTwin, review, setPendingTrainingQuestions, addToast, t]);

  const saveAsFact = useCallback((entry: HubEntry, importance: number) => run(entry.id, async () => {
    if (!twinId) return;
    const sources = provenanceOf(entry);
    if (sources.length === 0) throw new Error(t.errors.factNeedsSource);
    const fact = await twinApi.createDistilledFact(
      twinId, sources, entry.body, entry.contactHandle ?? undefined, importance,
    );
    patch((s) => ({ ...s, facts: [fact, ...s.facts] }));
  }), [run, twinId, patch, t]);

  const deleteFact = useCallback((entry: HubEntry) => run(entry.id, async () => {
    await twinApi.deleteDistilledFact(entry.id);
    patch((s) => ({ ...s, facts: s.facts.filter((f) => f.id !== entry.id) }));
  }), [run, patch]);

  const deleteReflection = useCallback((entry: HubEntry) => run(entry.id, async () => {
    await twinApi.deleteTwinReflection(entry.id);
    patch((s) => ({ ...s, reflections: s.reflections.filter((r) => r.id !== entry.id) }));
  }), [run, patch]);

  const reflect = useCallback((seed: string) => run(HUB_BUSY.reflect, async () => {
    if (!twinId) return;
    const row = await twinApi.reflectOnTwin(twinId, seed);
    patch((s) => ({ ...s, reflections: [row, ...s.reflections] }));
  }), [run, twinId, patch]);

  const compileWiki = useCallback(() => run(HUB_BUSY.wiki, async () => {
    if (!twinId) return;
    const out = await twinApi.compileWiki(twinId);
    addToast(t.toasts.wikiCompiled, 'success');
    patch((s) => ({ ...s, wiki: { exists: true, fileCount: out.fileCount, lastCompiledAt: out.compiledAt, dirPath: out.dirPath } }));
  }), [run, twinId, patch, addToast, t]);

  const auditWiki = useCallback(() => run(HUB_BUSY.audit, async () => {
    if (!twinId) return;
    const memory = await twinApi.auditWiki(twinId);
    patch((s) => ({ ...s, memories: [memory, ...s.memories] }));
  }), [run, twinId, patch]);

  const ingestDoctrine = useCallback(() => run(HUB_BUSY.doctrine, async () => {
    if (!twinId) return;
    await twinApi.ingestDoctrineDocs(twinId);
    addToast(t.toasts.doctrineIngested, 'success');
    await refresh();
  }), [run, twinId, addToast, refresh, t]);

  const bindKnowledgeBase = useCallback((id: string) => run(HUB_BUSY.kb, async () => {
    if (!twinId) return;
    await bindKb(twinId, id);
    await fetchTwinProfiles({ force: true });
  }), [run, twinId, bindKb, fetchTwinProfiles]);

  const unbindKnowledgeBase = useCallback(() => run(HUB_BUSY.kb, async () => {
    if (!twinId) return;
    await unbindKb(twinId);
    await fetchTwinProfiles({ force: true });
  }), [run, twinId, unbindKb, fetchTwinProfiles]);

  const loadKnowledgeBases = useCallback(async () => {
    setKnowledgeBases(await soft(listKnowledgeBases(), 'twin:hub:listKbs') ?? []);
  }, []);

  const createBoundKnowledgeBase = useCallback(() => run(HUB_BUSY.kb, async () => {
    if (!twinId || !activeTwin) return;
    const kb = await createKnowledgeBase(`${activeTwin.name} Brain`, `Knowledge base for twin: ${activeTwin.name}`);
    await bindKb(twinId, kb.id);
    await fetchTwinProfiles({ force: true });
  }), [run, twinId, activeTwin, bindKb, fetchTwinProfiles]);

  const entries = useMemo(() => (load.snap ? toEntries(load.snap) : []), [load.snap]);

  const counts = useMemo<HubCounts>(() => {
    const m = load.snap?.memories ?? [];
    return {
      pending: m.filter((x) => x.status === 'pending').length,
      approved: m.filter((x) => x.status === 'approved').length,
      rejected: m.filter((x) => x.status === 'rejected').length,
      messages: load.snap?.comms.length ?? 0,
      facts: load.snap?.facts.length ?? 0,
      reflections: load.snap?.reflections.length ?? 0,
    };
  }, [load.snap]);

  const sources = useMemo<HubSources>(() => ({
    knowledgeBaseId: kbId,
    knowledgeBaseName: load.snap?.kb?.name ?? null,
    documents: load.snap?.kb?.documentCount ?? null,
    chunks: load.snap?.kb?.chunkCount ?? null,
    obsidianSubpath: activeTwin?.obsidian_subpath ?? null,
    wikiCompiledAt: load.snap?.wiki?.lastCompiledAt ?? null,
    wikiFiles: load.snap?.wiki?.exists ? load.snap.wiki.fileCount : null,
  }), [kbId, load.snap, activeTwin]);

  return {
    entries, counts, sources,
    contacts: load.snap?.contacts ?? [],
    // Snap publishes incrementally (pending memories first). `loading` stays
    // true until every lane reports so Knowledge/History keep their ghosts;
    // QueueLane already paints as soon as `queue.length > 0`.
    loading: (load.snap === null || load.pending > 0) && load.error === null,
    error: load.error,
    refresh, approve, reject, digDeeper, saveAsFact, deleteFact, deleteReflection, reflect,
    compileWiki, auditWiki, ingestDoctrine, bindKnowledgeBase, unbindKnowledgeBase,
    busyId,
    twinId, twinName: activeTwin?.name ?? null,
    knowledgeBases, loadKnowledgeBases, createBoundKnowledgeBase,
  };
}
