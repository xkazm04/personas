/**
 * useDecisionCopy — binds {@link DecisionCopy} to the translation tree
 * (`t.monitor.dc_*`, plus the deck's own copy via `useTriageCopy`).
 */
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { actionLabel } from '@/features/companions/athena/athenaLabels';
import { useTriageCopy } from '@/features/agents/quick-answer/triage/useTriageCopy';
import { formatPercent } from '@/lib/utils/formatters';

import { COUNCIL_MIN_REASON, type DecisionCopy } from './decisionCopy';

/** The React binding: fills {@link DecisionCopy} from `t.monitor.dc_*`. */
export function useDecisionCopy(): DecisionCopy {
  const { t, tx, language } = useTranslation();
  const triage = useTriageCopy();
  const m = t.monitor;

  return useMemo<DecisionCopy>(
    () => ({
      triage,
      resolve: m.dc_resolve,
      dismiss: m.dc_dismiss,
      startWork: m.dc_start_work,
      startWorkHint: m.dc_start_work_hint,
      acknowledge: m.dc_acknowledge,
      acknowledgeHint: m.dc_acknowledge_hint,
      openExecution: m.dc_open_execution,
      openExecutionHint: m.dc_open_execution_hint,
      factStatus: m.dc_fact_status,
      factFirstSeen: m.dc_fact_first_seen,
      factKind: m.dc_fact_kind,
      sourceSystem: m.dc_source_system,
      markRead: m.dc_mark_read,
      followUpChat: m.dc_follow_up_chat,
      followUpChatHint: m.dc_follow_up_chat_hint,
      priorityCritical: m.dc_priority_critical,
      priorityHigh: m.dc_priority_high,
      priorityNormal: m.dc_priority_normal,
      priorityLow: m.dc_priority_low,
      reportUntitled: (name) => tx(m.dc_report_untitled, { name }),
      councilReasonTitle: m.dc_council_reason_title,
      councilReasonPlaceholder: tx(m.dc_council_reason_placeholder, { count: COUNCIL_MIN_REASON }),
      councilReasonBack: m.dc_council_reason_back,
      factRound: m.dc_fact_round,
      factOverall: m.dc_fact_overall,
      factCoverage: m.dc_fact_coverage,
      percent: (ratio) => formatPercent(ratio, { fromRatio: true, precision: 0, language }),
      councilSummaryIsDescription: m.dc_council_summary_is_description,
      councilNoSummary: m.dc_council_no_summary,
      sourceAthena: m.dc_source_athena,
      lowRisk: m.dc_low_risk,
      factAction: m.dc_fact_action,
      actionLabel: (action) => actionLabel(t, action),
      chatDone: m.dc_chat_done,
      chatDismiss: m.dc_chat_dismiss,
      chatYou: m.dc_chat_you,
      factLastMessage: m.dc_fact_last_message,
    }),
    [t, tx, m, triage, language],
  );
}
