// Runtime signal projected onto the context map (docs/plans/dev-findings-loop.md
// §2 1A) — the join that turns the ledger from "what this codebase IS" into "what
// this codebase DOES, costs, and breaks".
//
// Two sensors, two joins:
//   • LLM cost — pinpoints roll up per use case (slug); a use case slices N
//     contexts (`context_ids`), so cost flows from telemetry → use case → context.
//   • Sentry errors — an issue's `culprit` is usually a code location, and a
//     context owns `filePaths`. Match one against the other.
//
// ATTRIBUTION (read this before trusting a number): a use case's FULL cost is
// attributed to EVERY context it slices — it is not split between them. So the
// chip answers "how much LLM spend flows through this area", not "how much of the
// bill this area owns", and the column will sum to more than the project total.
// That's deliberate: splitting would invent precision the data doesn't have. The
// tooltip says so.
//
// Everything here is lazy and failure-tolerant: no tracer, no Sentry, or a dead
// API all degrade to empty maps. The ledger must never break because telemetry is.
import { useEffect, useMemo, useState } from 'react';

import {
  fetchLlmPinpoints,
  hasLiveAdapter,
} from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import {
  fetchSentryUnresolvedIssues,
  splitSentrySlug,
  type SentryUnresolvedIssue,
} from '@/features/plugins/dev-tools/sub_overview/adapters';
import { useVaultStore } from '@/stores/vaultStore';
import { slugifyUseCase } from '@/lib/useCaseSlug';
import { silentCatch } from '@/lib/silentCatch';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

export interface ContextRuntime {
  /** contextId → USD spent by the use cases slicing this context (see ATTRIBUTION). */
  costByContext: Map<string, number>;
  /** contextId → unresolved Sentry events attributed to its files. */
  errorsByContext: Map<string, number>;
}

const EMPTY: ContextRuntime = { costByContext: new Map(), errorsByContext: new Map() };

/** Normalize a path for comparison: forward slashes, lowercase, no leading `./`. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Does this Sentry culprit point at this file? Sentry culprits are messy — a bare
 * path, a `path in function`, a module name, sometimes not a path at all. We match
 * on path CONTAINMENT in either direction, which is permissive enough to catch the
 * real cases and specific enough not to attribute a crash to every context: an
 * unmatched culprit simply lands nowhere (and still becomes a project-level
 * finding via the sentry emitter).
 */
function culpritMatchesFile(culprit: string, filePath: string): boolean {
  const c = norm(culprit);
  const f = norm(filePath);
  if (!c || !f) return false;
  return c.includes(f) || f.includes(c);
}

export function contextErrorsFromIssues(
  issues: SentryUnresolvedIssue[],
  contexts: { id: string; filePaths: string[] }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.culprit) continue;
    for (const ctx of contexts) {
      if (ctx.filePaths.some((f) => culpritMatchesFile(issue.culprit!, f))) {
        out.set(ctx.id, (out.get(ctx.id) ?? 0) + issue.count);
      }
    }
  }
  return out;
}

/** Project use-case-level spend onto contexts through `context_ids`. */
export function contextCostFromSpend(
  costBySlug: Map<string, number>,
  useCases: DevUseCase[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const uc of useCases) {
    const cost = costBySlug.get(uc.slug);
    if (!cost) continue;
    for (const ctxId of uc.context_ids) {
      out.set(ctxId, (out.get(ctxId) ?? 0) + cost);
    }
  }
  return out;
}

export function useContextRuntime(
  project: DevProject | null | undefined,
  useCases: DevUseCase[],
  contexts: { id: string; filePaths: string[] }[],
): ContextRuntime {
  const credentials = useVaultStore((s) => s.credentials);
  const [costBySlug, setCostBySlug] = useState<Map<string, number>>(new Map());
  const [issues, setIssues] = useState<SentryUnresolvedIssue[]>([]);

  const llmCredId = project?.llm_tracking_credential_id ?? null;
  const monCredId = project?.monitoring_credential_id ?? null;
  const monSlug = project?.monitoring_project_slug ?? null;

  // Resolve credentials to PRIMITIVES before they reach an effect. Depending on
  // the `credentials` array itself would re-run the fetch on every render that
  // hands back a new array identity — which is a refetch → setState → render →
  // refetch loop that wedges the tab. Only the id + serviceType matter.
  const llmServiceType = useMemo(
    () => (llmCredId ? credentials.find((c) => c.id === llmCredId)?.serviceType ?? null : null),
    [llmCredId, credentials],
  );
  const monCredResolvedId = useMemo(
    () => (monCredId ? credentials.find((c) => c.id === monCredId)?.id ?? null : null),
    [monCredId, credentials],
  );

  // -- LLM spend per use-case slug (30d) --------------------------------------
  useEffect(() => {
    if (!llmCredId || !llmServiceType || !hasLiveAdapter(llmServiceType)) {
      setCostBySlug(new Map());
      return;
    }
    let cancelled = false;
    void fetchLlmPinpoints(llmServiceType, llmCredId, '30d')
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<string, number>();
        for (const r of rows) {
          if (r.useCaseName == null) continue;
          const slug = slugifyUseCase(r.useCaseName);
          m.set(slug, (m.get(slug) ?? 0) + r.totalCostUsd);
        }
        setCostBySlug(m);
      })
      .catch((e) => {
        silentCatch('useContextRuntime:llm')(e);
        if (!cancelled) setCostBySlug(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [llmCredId, llmServiceType]);

  // -- Sentry unresolved issues ----------------------------------------------
  useEffect(() => {
    const [orgSlug, projSlug] = splitSentrySlug(monSlug);
    if (!monCredResolvedId || !orgSlug || !projSlug) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    void fetchSentryUnresolvedIssues(monCredResolvedId, orgSlug, projSlug)
      .then((rows) => {
        if (!cancelled) setIssues(rows);
      })
      .catch((e) => {
        silentCatch('useContextRuntime:sentry')(e);
        if (!cancelled) setIssues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [monCredResolvedId, monSlug]);

  return useMemo(() => {
    if (costBySlug.size === 0 && issues.length === 0) return EMPTY;
    return {
      costByContext: contextCostFromSpend(costBySlug, useCases),
      errorsByContext: contextErrorsFromIssues(issues, contexts),
    };
  }, [costBySlug, issues, useCases, contexts]);
}
