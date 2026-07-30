/**
 * Morning Director — pure session-delta assembly + the deterministic
 * briefing compositions.
 *
 * `buildSessionDelta` promotes the "since you left" maths
 * (`sinceLeftBriefing.computeSinceLeftBriefing` inputs) into the
 * serializable document the backend composer consumes and validates
 * actions against.
 *
 * `composeFallbackBriefing` is the deterministic no-LLM briefing
 * (the `composeDefaultCockpit` model): built when the LLM path is
 * gated out by failure, so the surface never degrades to an error.
 * `composeQuietBriefing` is the honest empty state — "quiet night,
 * nothing needs you" — shown when the delta gate found nothing (no LLM
 * call fires for it, ever).
 *
 * Pure + framework-free so it unit-tests in isolation; all user-facing
 * strings arrive pre-localized via {@link BriefingLabels}.
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { FiredAlert } from '@/lib/bindings/FiredAlert';
import type { RunSample } from '@/stores/slices/overview/homeSpineWindows';
import type { CompanionCockpitSpecBody, CompanionCockpitWidget, PendingApproval } from '@/api/companion';
import type { SessionDelta } from '@/api/companion/briefing';

/** Max failing personas / alerts / approvals carried in the delta doc. */
const DELTA_PERSONA_LIMIT = 5;
const DELTA_ALERT_LIMIT = 5;
const DELTA_APPROVAL_LIMIT = 3;

export interface SessionDeltaInput {
  /** Previous session's end (epoch ms) — the frozen last-seen anchor. */
  lastSeen: number;
  runs: readonly RunSample[] | null;
  alerts: ReadonlyArray<FiredAlert>;
  approvals: readonly PendingApproval[];
  personas: readonly Persona[];
  openIncidents: number;
}

/**
 * Assemble the serializable delta document. Counting logic mirrors
 * `computeSinceLeftBriefing` exactly (same timestamp parsing + anchor
 * comparison) so the briefing and the Welcome debrief never disagree.
 */
export function buildSessionDelta(input: SessionDeltaInput): SessionDelta {
  const { lastSeen } = input;

  let runs = 0;
  let failedRuns = 0;
  const failedByPersona = new Map<string, number>();
  for (const r of input.runs ?? []) {
    const ts = Date.parse(r.created_at);
    if (Number.isNaN(ts) || ts <= lastSeen) continue;
    runs++;
    if (r.status === 'failed') {
      failedRuns++;
      failedByPersona.set(r.persona_id, (failedByPersona.get(r.persona_id) ?? 0) + 1);
    }
  }

  const personaById = new Map(input.personas.map((p) => [p.id, p]));
  const failedPersonas = [...failedByPersona.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, DELTA_PERSONA_LIMIT)
    .map(([id, failedCount]) => {
      const p = personaById.get(id);
      return {
        id,
        name: p?.name ?? id,
        failedCount,
        enabled: p?.enabled !== false,
      };
    });

  const firedSince = input.alerts.filter((a) => {
    const ts = Date.parse(a.fired_at);
    return !Number.isNaN(ts) && ts > lastSeen;
  });

  return {
    since: new Date(lastSeen).toISOString(),
    runs,
    failedRuns,
    alerts: firedSince.length,
    approvalsWaiting: input.approvals.length,
    openIncidents: input.openIncidents,
    failedPersonas,
    alertSummaries: firedSince.slice(0, DELTA_ALERT_LIMIT).map((a) => ({
      ruleName: a.rule_name,
      severity: String(a.severity),
      message: a.message,
      personaId: a.persona_id,
    })),
    pendingApprovals: input.approvals.slice(0, DELTA_APPROVAL_LIMIT).map((a) => ({
      id: a.id,
      action: a.action,
      rationale: a.rationale,
    })),
  };
}

/**
 * The delta gate, client side — mirrors `briefing::delta_is_trivial` in
 * Rust. When true, NO compose IPC fires. Open incidents deliberately
 * don't re-trigger a briefing on every launch.
 */
export function deltaIsTrivial(d: SessionDelta): boolean {
  return d.runs === 0 && d.failedRuns === 0 && d.alerts === 0 && d.approvalsWaiting === 0;
}

/** Localized strings the deterministic compositions slot in. */
export interface BriefingLabels {
  title: string;
  calloutTitle: string;
  quietTitle: string;
  quietBody: string;
  stat: {
    runs: string;
    failed: string;
    alerts: string;
    approvals: string;
    incidents: string;
  };
  attentionTitle: string;
  /** `{count}` interpolated failed-run sublabel, already resolved per row. */
  failedSublabel: (count: number) => string;
  approvalTitle: string;
  approvalHeadline: string;
  actions: {
    rerun: string;
    pause: string;
    approve: string;
    decline: string;
  };
}

/** Honest empty state — no runs, alerts, or approvals since last seen. */
export function composeQuietBriefing(labels: BriefingLabels): CompanionCockpitSpecBody {
  return {
    title: labels.title,
    widgets: [
      {
        id: 'briefing-quiet',
        kind: 'text_callout',
        title: labels.quietTitle,
        span: 12,
        config: { body: labels.quietBody, intent: 'good' },
      },
    ],
  };
}

/**
 * Deterministic fallback briefing — same widget vocabulary and action
 * enum as the LLM composition, built purely from the delta document.
 * Ordering encodes the doctrine: numbers first, then broken, then
 * waiting-on-you.
 */
export function composeFallbackBriefing(
  delta: SessionDelta,
  labels: BriefingLabels,
): CompanionCockpitSpecBody {
  const widgets: CompanionCockpitWidget[] = [
    {
      id: 'briefing-stats',
      kind: 'stat_grid',
      title: labels.calloutTitle,
      span: 12,
      config: {
        columns: 4,
        stats: [
          { label: labels.stat.runs, value: delta.runs },
          {
            label: labels.stat.failed,
            value: delta.failedRuns,
            intent: delta.failedRuns > 0 ? 'bad' : 'good',
          },
          {
            label: labels.stat.alerts,
            value: delta.alerts,
            intent: delta.alerts > 0 ? 'warn' : 'default',
          },
          {
            label: labels.stat.approvals,
            value: delta.approvalsWaiting,
            intent: delta.approvalsWaiting > 0 ? 'warn' : 'default',
          },
          ...(delta.openIncidents > 0
            ? [{ label: labels.stat.incidents, value: delta.openIncidents, intent: 'warn' }]
            : []),
        ],
      },
    },
  ];

  const worst = delta.failedPersonas[0];
  if (worst) {
    widgets.push({
      id: 'briefing-broken',
      kind: 'issue_list',
      title: labels.attentionTitle,
      span: 12,
      config: {
        items: delta.failedPersonas.map((p) => ({
          id: p.id,
          title: p.name,
          sublabel: labels.failedSublabel(p.failedCount),
          severity: 'bad',
        })),
      },
      // One rerun for the worst offender + a pause when it's still
      // enabled — mirrors what the LLM composition is allowed to emit.
      actions: [
        {
          kind: 'rerun_persona',
          personaId: worst.id,
          label: `${labels.actions.rerun} · ${worst.name}`,
        },
        ...(worst.enabled
          ? [
              {
                kind: 'pause_persona',
                personaId: worst.id,
                label: `${labels.actions.pause} · ${worst.name}`,
              },
            ]
          : []),
      ],
    });
  }

  const approval = delta.pendingApprovals[0];
  if (approval) {
    widgets.push({
      id: 'briefing-approval',
      kind: 'verdict',
      title: labels.approvalTitle,
      span: 12,
      config: {
        headline: labels.approvalHeadline,
        reasoning: approval.rationale,
        intent: 'warn',
      },
      actions: [
        { kind: 'approve_approval', approvalId: approval.id, label: labels.actions.approve },
        { kind: 'decline_approval', approvalId: approval.id, label: labels.actions.decline },
      ],
    });
  }

  return { title: labels.title, widgets };
}
