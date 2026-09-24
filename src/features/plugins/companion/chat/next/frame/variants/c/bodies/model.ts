/**
 * The card-native bodies' shared view model. Each supported work-item kind
 * (decision, approval, session request) is adapted ONCE into a `CardModel`
 * from the product's own logic hooks (`useDecisionCard`, `useApprovalCard`,
 * `useMcpRequestCard`), so the three body treatments render the same content
 * with the same verbs and none of them owns a verb.
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import { useCallback, useMemo } from 'react';
import { companionListRecentMessages, type PendingApproval } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { actionLabel } from '@/features/plugins/companion/athenaLabels';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { actionRisk } from '@/features/plugins/companion/decision/actionRisk';
import { useDecisionCard } from '@/features/plugins/companion/decision/useDecisionCard';
import { useMcpRequestStore, type McpPendingRequest } from '@/features/plugins/companion/mcp/mcpRequestStore';
import { useMcpRequestCard } from '@/features/plugins/companion/mcp/useMcpRequestCard';
import { useApprovalCard } from '@/features/plugins/companion/useApprovalCard';
import type { WorkItem, WorkItemKind } from '../../../../useWorkforce';
import { SPREAD_COPY as S } from '../copy';


export interface CardChoice {
  key: string;
  label: string;
  hint?: string;
  tone: 'primary' | 'danger' | 'neutral';
  recommended: boolean;
  busy: boolean;
  run: () => void | Promise<void>;
  testId?: string;
}

export interface CardRecommendation {
  /** What the line is: Athena's recommendation, or a static risk read. */
  label: string;
  text: string | null;
  /** Shown now (a decision's only after the operator asks, per the product). */
  revealed: boolean;
  /** The explain turn's progress line while it composes, else null. */
  composing: string | null;
  failed: string | null;
  /** `0` / Ask Athena: reveals and escalates to a cockpit explanation. */
  reveal: (() => void) | null;
}

export interface CardField {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline: boolean;
  disabled: boolean;
  /** A field with its own send verb (guidance answers). */
  submit: { label: string; run: () => void | Promise<void>; enabled: boolean; busy: boolean } | null;
}

export interface CardModel {
  /** Who is asking / what kind of call it is, in one short line. */
  eyebrow: string;
  question: string;
  /** The rationale / context behind the question. */
  context: string | null;
  /** Machine detail (params JSON), shown behind a reveal. */
  details: { label: string; code: string } | null;
  recommendation: CardRecommendation | null;
  choices: CardChoice[];
  field: CardField | null;
  error: string | null;
  warning: string | null;
  /** Secondary ways past the card without answering it (decision Later / Skip). */
  deferrals: { key: string; label: string; hint: string; run: () => void }[];
  waiting: number;
  busy: boolean;
}

const NATIVE: ReadonlySet<WorkItemKind> = new Set(['decision', 'approval', 'session_request']);
export const hasNativeBody = (kind: WorkItemKind) => NATIVE.has(kind);

function rawId(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

function refreshTranscript() {
  const store = useCompanionStore.getState();
  companionListRecentMessages(50, store.activeConversationId)
    .then((msgs) => useCompanionStore.getState().setMessages(msgs))
    .catch(silentCatch('companion_list_recent_messages'));
}

/* ------------------------------------------------------------------------ */

export function useDecisionModel(): CardModel | null {
  const { t } = useTranslation();
  const tc = t.plugins.companion;
  const m = useDecisionCard();
  const d = m.decision;
  return useMemo(() => {
    if (!d) return null;
    const choices: CardChoice[] = d.options.map((o, i) => ({
      key: o.key,
      label: o.label,
      hint: o.hint,
      tone: o.danger ? 'danger' : 'primary',
      recommended: m.explained && i === m.recommendedIndex,
      busy: false,
      run: () => m.pickOption(o),
      testId: `spread-decision-option-${i + 1}`,
    }));
    return {
      eyebrow: S.eyebrowDecision,
      question: d.prompt,
      context: m.explained ? (d.detail ?? null) : null,
      details: null,
      recommendation: {
        label: S.recommended,
        text: d.recommendation ?? null,
        revealed: m.explained,
        composing: m.composing ? tc.decision_composing : null,
        failed: m.composeError ? tc.decision_compose_failed : null,
        reveal: m.composing ? null : m.explain,
      },
      choices,
      field: null,
      error: m.runError ? tc.decision_run_failed : null,
      warning: null,
      deferrals: [
        { key: 'later', label: tc.decision_later, hint: tc.decision_snooze_hint, run: m.later },
        { key: 'skip', label: tc.decision_skip, hint: tc.decision_skip_hint, run: m.skip },
      ],
      waiting: m.waitingBehind,
      busy: false,
    };
  }, [d, m, tc]);
}

/* ------------------------------------------------------------------------ */

export function useApprovalItem(item: WorkItem): PendingApproval | null {
  const id = rawId(item.id);
  return useCompanionStore((s) => s.approvals.find((a) => a.id === id) ?? null);
}

export function useApprovalModel(approval: PendingApproval): CardModel {
  const { t } = useTranslation();
  const tc = t.plugins.companion;
  const onResolved = useCallback((id: string) => {
    useCompanionStore.getState().removeApproval(id);
    refreshTranscript();
  }, []);
  const a = useApprovalCard(approval, onResolved);
  const low = actionRisk(approval.action) === 'low';
  const label = actionLabel(t, approval.action);
  return {
    eyebrow: S.eyebrowApproval(label),
    question: approval.rationale || label,
    context: null,
    details: { label: tc.action_params, code: a.prettyParams },
    recommendation: { label: S.riskRead, text: low ? S.lowRisk : S.elevatedRisk, revealed: true, composing: null, failed: null, reveal: null },
    choices: [
      { key: 'approve', label: tc.approve, tone: 'primary', recommended: low, busy: a.busy === 'approve', run: a.approve, testId: 'spread-approve' },
      { key: 'reject', label: tc.reject, tone: 'danger', recommended: false, busy: a.busy === 'reject', run: a.reject, testId: 'spread-reject' },
    ],
    field: null,
    error: a.error,
    warning: a.failedOutcome ? tc.approved_failed.replace('{message}', a.failedOutcome) : null,
    deferrals: [],
    waiting: 0,
    busy: a.busy !== null,
  };
}

/* ------------------------------------------------------------------------ */

export function useMcpItem(item: WorkItem): McpPendingRequest | null {
  const id = rawId(item.id);
  return useMcpRequestStore((s) => s.pendingRequests.find((r) => r.requestId === id) ?? null);
}

export function useMcpModel(request: McpPendingRequest): CardModel {
  const { t } = useTranslation();
  const to = t.plugins.companion.orchestration;
  const r = useMcpRequestCard(request);
  const busy = r.sending !== null;
  if (r.guidance) {
    return {
      eyebrow: S.eyebrowGuidance(r.sessionShort),
      question: r.guidance.question,
      context: r.guidance.context,
      details: null,
      recommendation: null,
      choices: [],
      field: {
        label: S.answerLabel,
        value: r.answer,
        onChange: r.setAnswer,
        placeholder: to.guidance_placeholder,
        multiline: true,
        disabled: busy,
        submit: { label: to.guidance_send, run: r.sendAnswer, enabled: r.canAnswer, busy: r.sending === 'answer' },
      },
      error: null,
      warning: null,
      deferrals: [],
      waiting: 0,
      busy,
    };
  }
  const p = r.approval;
  return {
    eyebrow: S.eyebrowMcpApproval(r.sessionShort),
    question: p?.action ?? request.kind,
    context: p?.rationale || null,
    details: null,
    recommendation: null,
    choices: [
      { key: 'approve', label: to.approval_approve, tone: 'primary', recommended: false, busy: r.sending === 'approve', run: r.approve, testId: 'spread-mcp-approve' },
      { key: 'deny', label: to.approval_deny, tone: 'danger', recommended: false, busy: r.sending === 'deny', run: r.deny, testId: 'spread-mcp-deny' },
    ],
    field: {
      label: S.noteLabel,
      value: r.note,
      onChange: r.setNote,
      placeholder: to.approval_note_placeholder,
      multiline: false,
      disabled: busy,
      submit: null,
    },
    error: null,
    warning: null,
    deferrals: [],
    waiting: 0,
    busy,
  };
}
