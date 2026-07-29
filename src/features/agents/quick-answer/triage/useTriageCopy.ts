/**
 * useTriageCopy — the translated strings the triage adapters need.
 *
 * The model layer (`triageTypes` / `triageAdapters`) is deliberately i18n-free:
 * adapters receive already-translated copy so the same `TriageItem` can be
 * rendered by surfaces that resolve strings differently. This hook is the one
 * place that binds that contract to the app's translation tree.
 */
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DEFAULT_TRIAGE_COPY, type TriageCopy } from './triageAdapters';

export function useTriageCopy(): TriageCopy {
  const { t } = useTranslation();
  const m = t.monitor;

  return useMemo<TriageCopy>(
    () => ({
      ...DEFAULT_TRIAGE_COPY,
      accept: m.triage_accept,
      reject: m.triage_reject,
      skip: m.triage_skip,
      adopt: m.triage_adopt,
      approve: m.triage_approve,
      submit: m.triage_submit,
      defer: m.triage_defer,
      buildNow: m.triage_build_now,
      buildNowHint: m.triage_build_now_hint,
      deprecate: m.triage_deprecate,
      deprecateHint: m.triage_deprecate_hint,
      openBuilder: m.triage_open_builder,
      openBuilderHint: m.triage_open_builder_hint,
      carryOutHint: m.triage_carry_out_hint,
      severity: m.triage_fact_severity,
      reviewType: m.triage_fact_type,
      persona: m.triage_fact_persona,
      raised: m.triage_fact_raised,
      project: m.triage_fact_project,
      category: m.triage_fact_category,
      origin: m.triage_fact_origin,
      scanner: m.triage_origin_scanner,
      effort: m.triage_fact_effort,
      impact: m.triage_fact_impact,
      risk: m.triage_fact_risk,
      value: m.triage_fact_value,
      topic: m.triage_fact_topic,
      practiceKind: m.triage_fact_kind,
      altitude: m.triage_fact_altitude,
      durability: m.triage_fact_durability,
      confidence: m.triage_fact_confidence,
      evidenceSeen: m.triage_fact_evidence_seen,
      workspace: m.triage_fact_workspace,
      answerPlaceholder: m.triage_answer_placeholder,
      noDescription: m.triage_no_description,
      cloud: m.triage_source_cloud,
      local: m.triage_source_local,
    }),
    [m],
  );
}
