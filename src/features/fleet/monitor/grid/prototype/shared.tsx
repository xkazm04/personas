// Shared prototype primitives: the non-visual halves of the header controls and
// the node facts every variant prints. PROTOTYPE — each piece mirrors a
// baseline component's logic (`MaxParallelStepper`, `QueueTile`, `PersonaTile`,
// `SessionTile`) with the pixels removed, so the variants can only differ in
// how they SAY a fact, never in which fact they say.

import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { setAppSetting } from '@/api/system/settings';
import { toastCatch } from '@/lib/silentCatch';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { clampToBound, FLEET_MAX_PARALLEL_SESSIONS_BOUNDS, isWithin } from '@/features/settings/sub_limits/autopilotBounds';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../monitorModel';
import { actionBadges, cleanName, squareState, type ActionKind, type SquareState } from '../fleetGridModel';
import { sessionLabel, sessionStateMeta } from '../fleetSessionModel';
import { asOrigin, type QueueItem } from '../board/queue/useQueueModel';
import { originLabel } from '../board/queue/originLabel';
import type { QueueActions } from '../board/queue/useQueueActions';
import { ORIGIN_GLYPH } from '../board/node/nodeSymbols';

// ── The fleet cap (MaxParallelStepper's logic) ─────────────────────────────

const BOUND = FLEET_MAX_PARALLEL_SESSIONS_BOUNDS;

export function useCapSetting(disabled: boolean) {
  const { t } = useTranslation();
  const setting = useAppSetting(BOUND.key, String(BOUND.defaultValue), (v) => isWithin(BOUND, v));
  const cap = clampToBound(BOUND, Number(setting.value));
  const write = useCallback(
    (next: number) => {
      const v = clampToBound(BOUND, next);
      if (v === cap) return;
      const prev = setting.value;
      setting.setValue(String(v));
      setAppSetting(BOUND.key, String(v)).catch((err: unknown) => {
        setting.setValue(prev);
        toastCatch('fleet/prototype:cap', t.monitor.queue_action_failed)(err);
      });
    },
    [cap, setting, t.monitor.queue_action_failed],
  );
  const canEdit = setting.loaded && !disabled;
  return {
    cap,
    min: BOUND.min,
    max: BOUND.max,
    canDecrease: canEdit && cap > BOUND.min,
    canIncrease: canEdit && cap < BOUND.max,
    decrease: () => write(cap - 1),
    increase: () => write(cap + 1),
  };
}

// ── Queue verbs behind a confirm (QueueTile's logic) ───────────────────────

type Confirm = { kind: 'cancel' | 'start'; item: QueueItem } | null;

export function useQueueConfirm(actions: QueueActions) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const [pending, setPending] = useState<Confirm>(null);
  const askStart = useCallback((item: QueueItem) => setPending({ kind: 'start', item }), []);
  const askCancel = useCallback((item: QueueItem) => setPending({ kind: 'cancel', item }), []);
  const close = () => setPending(null);
  const name = pending ? sessionLabel(pending.item.session) : '';
  const dialog = pending?.kind === 'cancel' ? (
    <ConfirmDialog
      title={s.queue_cancel_title}
      body={tx(s.queue_cancel_body, { name })}
      danger
      confirmLabel={s.queue_cancel}
      onConfirm={async () => { if (await actions.cancel(pending.item.sessionId)) close(); }}
      onCancel={close}
    />
  ) : pending?.kind === 'start' ? (
    <ConfirmDialog
      title={s.queue_start_now_title}
      body={tx(s.queue_start_now_body, { name })}
      confirmLabel={s.queue_start_now}
      onConfirm={async () => { if (await actions.startNow(pending.item.sessionId)) close(); }}
      onCancel={close}
    />
  ) : null;
  return { askStart, askCancel, dialog };
}

// ── Node facts ────────────────────────────────────────────────────────────

export interface PendingFact {
  key: ActionKind;
  count: number;
  /** Human phrase, e.g. "2 reviews waiting". */
  label: string;
  icon: ReturnType<typeof actionBadges>[number]['icon'];
  /** Semantic tone for the variant to map onto its own palette. */
  tone: 'error' | 'warning' | 'info' | 'processing';
}

function toneOf(chip: string): PendingFact['tone'] {
  if (chip.includes('status-error')) return 'error';
  if (chip.includes('status-warning')) return 'warning';
  if (chip.includes('status-processing')) return 'processing';
  return 'info';
}

/** Everything a persona node can say, in words. */
export function usePersonaFacts() {
  const { t, tx } = useTranslation();
  const stateLabel: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };
  const pendingLabel = (kind: ActionKind, count: number): string => {
    switch (kind) {
      case 'failed': return t.monitor.grid_badge_failed;
      case 'review': return tx(t.monitor.grid_badge_review, { count });
      case 'input': return tx(t.monitor.grid_badge_input, { count });
      case 'draft': return tx(t.monitor.grid_badge_draft, { count });
      case 'message': return tx(t.monitor.grid_badge_message, { count });
    }
  };
  return useCallback((card: PersonaCardModel) => {
    const state = squareState(card);
    const pending: PendingFact[] = actionBadges(card).map((b) => ({
      key: b.key, count: b.count, icon: b.icon, tone: toneOf(b.tone), label: pendingLabel(b.key, b.count),
    }));
    return {
      name: cleanName(card.personaName),
      state,
      stateLabel: stateLabel[state],
      pending,
      off: card.enabled === false,
      successRate: card.successRate,
      runsToday: card.runsToday,
      recent: card.recentStatuses,
      runningSince: card.runningSince,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tx]);
}

/** Everything a session node can say, in words. */
export function useSessionFacts() {
  const { t } = useTranslation();
  return useCallback((s: FleetSession, item?: QueueItem | null) => {
    const meta = sessionStateMeta(s.state);
    const origin = item?.origin ?? asOrigin(s.origin);
    return {
      label: sessionLabel(s),
      state: s.state,
      stateLabel: t.plugins.fleet[meta.labelKey] as string,
      /** Tailwind dot class from the canonical fleet palette. */
      stateDot: meta.dot,
      origin,
      originLabel: originLabel(t.monitor, origin),
      OriginIcon: ORIGIN_GLYPH[origin],
      project: s.projectLabel || null,
      startedAt: Number(s.createdAtMs),
      lastActivity: Number(s.lastActivityMs),
    };
  }, [t]);
}

/** `12s`, `4m`, `1h 20m` — compact elapsed for a live row. */
export function shortElapsed(fromMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
