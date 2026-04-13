import { useEffect, useState, useMemo, useRef } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { discoverConnectorResources, type DiscoveredItem } from '@/api/templates/discovery';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { createLogger } from '@/lib/log';

const logger = createLogger('dynamic-question-options');

export interface DynamicOptionState {
  /** Fetch is in flight (or waiting for a depends_on answer). */
  loading: boolean;
  /** Fetch finished and produced at least one row. */
  ready: boolean;
  /** Error message if the fetch or parse failed. UI shows a retry affordance. */
  error: string | null;
  /** Discovered items, or empty before the fetch resolves. */
  items: DiscoveredItem[];
  /** Is this question waiting on an unanswered `depends_on` parent? */
  waitingOnParent: boolean;
}

const EMPTY_STATE: DynamicOptionState = {
  loading: false,
  ready: false,
  error: null,
  items: [],
  waitingOnParent: false,
};

/**
 * Resolve dynamic option lists for a batch of adoption questions.
 *
 * For each question whose `dynamic_source` points at a healthy credential in
 * the user's vault, this hook fires a `discover_connector_resources` IPC call
 * and exposes the resulting `{value, label, sublabel}` list to the
 * questionnaire UI. Failures surface a retry affordance; questions without
 * `dynamic_source` simply return `EMPTY_STATE` and fall through to the
 * existing static-option rendering path.
 *
 * Chained discovery (`depends_on`) waits until the parent question's answer
 * exists, then passes it as `{{param.<depends_on>}}` to the Rust side. The
 * request is re-issued whenever the parent answer changes.
 *
 * Codebases is the one service_type that does not require a real credential;
 * we detect that and synthesize a `"local"` credential id so the backend
 * takes the `LocalCodebases` branch.
 */
export function useDynamicQuestionOptions(
  questions: TransformQuestionResponse[],
  userAnswers: Record<string, string>,
): {
  dynamicOptions: Record<string, DynamicOptionState>;
  retry: (questionId: string) => void;
} {
  const credentials = useVaultStore((s) => s.credentials);

  // Map of question id → stable dependency key; changing the key triggers a refetch.
  const [retryCounters, setRetryCounters] = useState<Record<string, number>>({});
  const [stateByQuestion, setStateByQuestion] = useState<Record<string, DynamicOptionState>>({});

  // Track the most recent request per question so late responses don't clobber
  // newer ones when the parent answer changes rapidly.
  const requestIdRef = useRef<Record<string, number>>({});

  // Fingerprint the inputs for each question so we only refetch when something
  // that actually affects the result (credential, parent answer, retry count)
  // has changed. Without this, every keystroke in an unrelated text field
  // would re-issue every discovery call.
  const lastFingerprintRef = useRef<Record<string, string>>({});

  // Pre-compute the first healthy credential per service_type the questions ask for.
  const credentialByService = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of credentials) {
      if (c.healthcheck_last_success === false) continue;
      if (!out[c.service_type]) out[c.service_type] = c.id;
    }
    return out;
  }, [credentials]);

  useEffect(() => {
    // Walk each question and decide whether to (re)fetch.
    for (const q of questions) {
      const src = q.dynamic_source;
      if (!src) continue;

      // Chained: wait for the parent answer.
      if (src.depends_on && !userAnswers[src.depends_on]) {
        setStateByQuestion((prev) => {
          if (prev[q.id]?.waitingOnParent) return prev;
          return { ...prev, [q.id]: { ...EMPTY_STATE, waitingOnParent: true } };
        });
        continue;
      }

      // Codebases bypasses the credential check — the backend reads
      // dev_projects directly and ignores the id (we still send a placeholder
      // to satisfy the command signature).
      const credentialId =
        src.service_type === 'codebases'
          ? 'local'
          : credentialByService[src.service_type];

      if (!credentialId) {
        setStateByQuestion((prev) => {
          if (prev[q.id]?.error) return prev;
          return {
            ...prev,
            [q.id]: {
              ...EMPTY_STATE,
              error: `No healthy ${src.service_type} credential connected`,
            },
          };
        });
        continue;
      }

      const params: Record<string, string> = {};
      if (src.depends_on) {
        params[src.depends_on] = userAnswers[src.depends_on]!;
      }

      const fingerprint = [
        credentialId,
        src.service_type,
        src.operation,
        params[src.depends_on ?? ''] ?? '',
        retryCounters[q.id] ?? 0,
      ].join('|');
      if (lastFingerprintRef.current[q.id] === fingerprint) continue;
      lastFingerprintRef.current[q.id] = fingerprint;

      const requestId = (requestIdRef.current[q.id] ?? 0) + 1;
      requestIdRef.current[q.id] = requestId;

      setStateByQuestion((prev) => ({
        ...prev,
        [q.id]: { ...EMPTY_STATE, loading: true },
      }));

      void discoverConnectorResources(
        credentialId,
        src.service_type,
        src.operation,
        params,
      )
        .then((items) => {
          // Stale response — a newer request has been issued.
          if (requestIdRef.current[q.id] !== requestId) return;
          setStateByQuestion((prev) => ({
            ...prev,
            [q.id]: {
              loading: false,
              ready: true,
              error: null,
              items,
              waitingOnParent: false,
            },
          }));
        })
        .catch((err: unknown) => {
          if (requestIdRef.current[q.id] !== requestId) return;
          // Tauri serializes AppError as `{error: string, kind: string}` —
          // prefer the `error` field, fall back to `message`, then stringify.
          const extractMessage = (e: unknown): string => {
            if (!e) return 'Unknown error';
            if (typeof e === 'string') return e;
            if (typeof e === 'object') {
              const obj = e as Record<string, unknown>;
              if (typeof obj.error === 'string') return obj.error;
              if (typeof obj.message === 'string') return obj.message;
              try {
                return JSON.stringify(obj);
              } catch {
                return String(e);
              }
            }
            return String(e);
          };
          const message = extractMessage(err);
          logger.warn('Dynamic option fetch failed', {
            questionId: q.id,
            serviceType: src.service_type,
            operation: src.operation,
            error: message,
            raw: err,
          });
          setStateByQuestion((prev) => ({
            ...prev,
            [q.id]: {
              loading: false,
              ready: false,
              error: message || 'Failed to load options',
              items: [],
              waitingOnParent: false,
            },
          }));
        });
    }
    // Intentionally depends on retryCounters so retry() re-fires the effect.
  }, [questions, userAnswers, credentialByService, retryCounters]);

  const retry = (questionId: string) => {
    setRetryCounters((prev) => ({ ...prev, [questionId]: (prev[questionId] ?? 0) + 1 }));
  };

  return { dynamicOptions: stateByQuestion, retry };
}
