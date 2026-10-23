import { useCallback, useSyncExternalStore } from 'react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { listTeamAssignmentSteps } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';

// `usePersonaIndex` moved to `personaIndex.ts` (a lean, markdown-free module) so
// that App-root-mounted eager consumers (LiveChannelOverlay → MergedRow) don't
// drag this file's MarkdownRenderer stack into the eager bundle. Re-exported
// here so existing lazy-loaded consumers of `boardShared` keep working.
export { usePersonaIndex } from './personaIndex';

/* ----------------------------------------------------------------------------
 * Shared team primitives: persona chips and the shared assignment-steps store.
 * The assignment-board relay (StepRelay, status meta, progress strip, goal chip)
 * was deleted 2026-10-19 with zero consumers: it was the only reason this
 * module imported MarkdownRenderer, which every importer (fleet channel bands,
 * the overview timeline, dev-tools projects) then pulled in transitively.
 * -------------------------------------------------------------------------- */

/** Small persona chip: icon + short name. */
export function PersonaChip({ persona, dim }: { persona: Persona | undefined; dim?: boolean }) {
  if (!persona) return null;
  const short = persona.name.replace(/^T: /, '');
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/10 max-w-[160px] ${
        dim ? 'opacity-60' : ''
      }`}
      title={short}
    >
      <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
      <span className="typo-caption text-foreground truncate">{short}</span>
    </span>
  );
}

/** Overlapping stack of unique persona icons (e.g. on a kanban card). */
export function PersonaStack({ ids, index, max = 4 }: { ids: Array<string | null>; index: Map<string, Persona>; max?: number }) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return null;
  const shown = unique.slice(0, max);
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((id) => {
        const p = index.get(id);
        if (!p) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary/80 ring-2 ring-background"
            title={p.name.replace(/^T: /, '')}
          >
            <PersonaIcon icon={p.icon} color={p.color} size="w-3 h-3" />
          </span>
        );
      })}
      {unique.length > max && (
        <span className="pl-2 typo-caption text-foreground">+{unique.length - max}</span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Shared assignment-steps store (C3).
 *
 * The previous hook was per-instance: every mounted card fetched on mount and,
 * while live, ran its OWN 5s interval — and virtualized timelines mount/unmount
 * cards on every scroll, so scrolling a busy conversation was a refetch storm
 * (one IPC per card scrolled into view, N intervals for N visible live cards).
 *
 * Now one module-scoped entry per assignmentId: a warm snapshot (a remount
 * inside the freshness window renders instantly with no fetch), one shared
 * interval per live assignment regardless of subscriber count, and in-flight
 * dedupe. Entries are retained after the last unsubscribe on purpose — the
 * scroll-away/scroll-back cycle is the hot path, and the set is bounded by
 * assignments actually viewed this session.
 * -------------------------------------------------------------------------- */

interface StepsSnapshot {
  steps: TeamAssignmentStep[];
  loaded: boolean;
}
const EMPTY_STEPS: StepsSnapshot = { steps: [], loaded: false };

interface StepsEntry {
  snapshot: StepsSnapshot;
  subs: Set<() => void>;
  liveCount: number;
  timer: ReturnType<typeof setInterval> | null;
  inflight: boolean;
  fetchedAt: number;
}

const stepsStore = new Map<string, StepsEntry>();
const STEPS_POLL_MS = 5_000;
/** A snapshot younger than this satisfies a new subscriber without a fetch. */
const STEPS_FRESH_MS = 4_000;

function stepsEntry(id: string): StepsEntry {
  let e = stepsStore.get(id);
  if (!e) {
    e = { snapshot: EMPTY_STEPS, subs: new Set(), liveCount: 0, timer: null, inflight: false, fetchedAt: 0 };
    stepsStore.set(id, e);
  }
  return e;
}

function fetchAssignmentSteps(id: string): void {
  const e = stepsEntry(id);
  if (e.inflight) return;
  e.inflight = true;
  listTeamAssignmentSteps(id)
    .then((s) => {
      e.fetchedAt = Date.now();
      e.snapshot = { steps: [...s].sort((a, b) => a.stepOrder - b.stepOrder), loaded: true };
      e.subs.forEach((cb) => cb());
    })
    .catch(silentCatch('teams/boardShared:useAssignmentSteps'))
    .finally(() => {
      e.inflight = false;
    });
}

/**
 * Steps for one assignment, kept fresh: warm shared snapshot on mount, one
 * shared gentle interval per live assignment. The global assignment progress
 * listener keeps the assignment rows fresh; this fills the step-level gap for
 * the focused assignment.
 */
export function useAssignmentSteps(assignmentId: string | null, live: boolean) {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!assignmentId) return () => {};
      const e = stepsEntry(assignmentId);
      e.subs.add(cb);
      if (Date.now() - e.fetchedAt > STEPS_FRESH_MS) fetchAssignmentSteps(assignmentId);
      if (live) {
        e.liveCount += 1;
        if (!e.timer) e.timer = setInterval(() => fetchAssignmentSteps(assignmentId), STEPS_POLL_MS);
      }
      return () => {
        e.subs.delete(cb);
        if (live) {
          e.liveCount -= 1;
          if (e.liveCount <= 0 && e.timer) {
            clearInterval(e.timer);
            e.timer = null;
          }
        }
      };
    },
    [assignmentId, live],
  );

  const getSnapshot = useCallback(
    () => (assignmentId ? stepsEntry(assignmentId).snapshot : EMPTY_STEPS),
    [assignmentId],
  );

  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback(() => {
    if (assignmentId) fetchAssignmentSteps(assignmentId);
  }, [assignmentId]);

  return { steps: snap.steps, loaded: snap.loaded, refresh };
}
