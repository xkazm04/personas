import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  validatePayload,
  HealingOutputSchema,
  HealingStatusSchema,
} from '@/lib/validation/eventPayloads';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createCliStreamBuffer } from './cliStreamBuffer';

export type AiHealingPhase =
  | 'idle'
  | 'started'
  | 'diagnosing'
  | 'applying'
  | 'completed'
  | 'failed';

export interface AiHealingState {
  phase: AiHealingPhase;
  lines: string[];
  lastLine: string;
  diagnosis: string | null;
  fixesApplied: string[];
  shouldRetry: boolean;
  executionId: string | null;
}

/**
 * Every phase the backend can emit on `ai-healing-status`
 * (`src-tauri/.../healing`: started / diagnosing / applying / completed /
 * failed) plus the frontend-only `idle`.
 */
const AI_HEALING_PHASES: readonly AiHealingPhase[] = [
  'idle',
  'started',
  'diagnosing',
  'applying',
  'completed',
  'failed',
];

const reportUnknownPhase = silentCatch('useAiHealingStream:unknownPhase');

/**
 * Parse the `phase` field of a healing status event.
 *
 * The payload schema types `phase` as a bare `string`, and this used to be
 * `validated.phase as AiHealingPhase` -- an unchecked cast that wrote any
 * string the backend (or a version-drifted backend) sent straight into React
 * state, where every consumer's `if` chain fell through to the "still
 * working" branch. Returns `null` for anything unrecognised so the caller can
 * keep the last phase it actually understood.
 */
function toAiHealingPhase(raw: unknown): AiHealingPhase | null {
  // Invariant: the `includes` check above narrows `raw` to a member of the
  // AiHealingPhase union; TypeScript cannot express that through
  // `readonly AiHealingPhase[]`.`includes(string)`.
  return typeof raw === 'string' && (AI_HEALING_PHASES as readonly string[]).includes(raw)
    ? (raw as AiHealingPhase)
    : null;
}

const MAX_LINES = 500;
const MAX_LINE_LENGTH = 4096;

const INITIAL_STATE: AiHealingState = {
  phase: 'idle',
  lines: [],
  lastLine: '',
  diagnosis: null,
  fixesApplied: [],
  shouldRetry: false,
  executionId: null,
};

/**
 * Listen for AI healing events scoped to a persona.
 *
 * Subscribes to `ai-healing-output` (streamed log lines) and
 * `ai-healing-status` (phase changes) events filtered by `personaId`.
 */
export function useAiHealingStream(personaId: string): AiHealingState {
  const [state, setState] = useState<AiHealingState>(INITIAL_STATE);
  const personaIdRef = useRef(personaId);
  personaIdRef.current = personaId;

  useEffect(() => {
    // Reset when persona changes
    setState(INITIAL_STATE);

    let mounted = true;
    const pendingListeners: Promise<UnlistenFn>[] = [];

    // Same per-frame batching the correlated CLI stream uses: a healing run
    // streams its diagnosis line by line, and each Tauri event is its own
    // task, so React cannot batch these `setState` calls itself. Adjacent
    // duplicates are deliberately NOT suppressed here -- unlike the CLI
    // stream, this log has always kept repeated lines.
    const buffer = createCliStreamBuffer({
      maxHeld: MAX_LINES,
      onBatch: (batch) => {
        if (!mounted) return;
        setState((prev) => {
          const merged = prev.lines.concat(batch);
          const lines =
            merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
          return { ...prev, lines, lastLine: lines[lines.length - 1] ?? prev.lastLine };
        });
      },
    });

    const outputPromise = listen<Record<string, unknown>>(
      EventName.AI_HEALING_OUTPUT,
      (event) => {
        if (!mounted) return;
        const raw = event.payload ?? {};
        const validated = validatePayload(EventName.AI_HEALING_OUTPUT, raw, HealingOutputSchema);
        if (!validated) return;
        if (validated.persona_id !== personaIdRef.current) return;

        const rawLine = validated.line;
        if (rawLine.trim().length === 0) return;

        const line =
          rawLine.length > MAX_LINE_LENGTH
            ? rawLine.slice(0, MAX_LINE_LENGTH) + '...[truncated]'
            : rawLine;

        buffer.push(line);
      },
    );
    pendingListeners.push(outputPromise);

    const statusPromise = listen<Record<string, unknown>>(
      EventName.AI_HEALING_STATUS,
      (event) => {
        if (!mounted) return;
        const raw = event.payload ?? {};
        const validated = validatePayload(EventName.AI_HEALING_STATUS, raw, HealingStatusSchema);
        if (!validated) return;
        if (validated.persona_id !== personaIdRef.current) return;

        // A phase change is the end of a thought: deliver the lines that
        // explain it before the phase that summarises them.
        buffer.flushNow();

        const phase = toAiHealingPhase(validated.phase);
        if (phase === null) {
          reportUnknownPhase(
            new Error(`Unrecognised AI healing phase "${String(validated.phase)}"`),
          );
        }

        setState((prev) => ({
          ...prev,
          // An unrecognised phase must not overwrite the last one we
          // understood -- the other fields of the event are still merged.
          phase: phase ?? prev.phase,
          executionId: validated.execution_id ?? prev.executionId,
          diagnosis: validated.diagnosis ?? prev.diagnosis,
          fixesApplied: validated.fixes_applied
            ? (validated.fixes_applied as string[])
            : prev.fixesApplied,
          shouldRetry: validated.should_retry ?? prev.shouldRetry,
        }));
      },
    );
    pendingListeners.push(statusPromise);

    // Release anything that landed while the two registrations were in flight.
    void Promise.allSettled(pendingListeners).then(() => {
      if (mounted) buffer.arm();
    });

    return () => {
      mounted = false;
      buffer.dispose();
      // Await any still-pending listener registrations, then tear them all down.
      // Use allSettled so one rejected registration doesn't prevent cleanup of others.
      void Promise.allSettled(pendingListeners).then((results) => {
        for (const r of results) {
          if (r.status === 'fulfilled') r.value();
        }
      });
    };
  }, [personaId]);

  return state;
}
