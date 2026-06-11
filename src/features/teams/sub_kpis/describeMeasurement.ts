// Plain-language measurement descriptions (P5): every measure_config renders
// as a sentence a non-technical user can read; the raw procedure JSON lives
// behind a "show procedure" disclosure for power users.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { Translations } from '@/i18n/generated/types';

type Tx = (template: string, vars: Record<string, string | number>) => string;

/** Friendly name for the tool a codebase command runs. */
function toolName(cmd: string, t: Translations): string {
  const c = cmd.toLowerCase();
  if (c.includes('vitest') || c.includes('jest') || c.includes('pytest') || c.includes('coverage'))
    return t.kpis.tool_test_suite;
  if (c.includes('eslint') || c.includes('lint')) return t.kpis.tool_linter;
  if (c.includes('build') || c.includes('tsc') || c.includes('vite')) return t.kpis.tool_build;
  return t.kpis.tool_command;
}

/** What the parse strategy reads out of the output. */
function readsWhat(parse: string, t: Translations): string {
  if (parse === 'coverage_pct') return t.kpis.reads_coverage;
  if (parse === 'count_lines') return t.kpis.reads_line_count;
  if (parse.startsWith('json_path:')) return t.kpis.reads_reported_number;
  return t.kpis.reads_reported_number;
}

/** Fixed sentences for the derived-metric catalog. */
const DERIVED_SENTENCES: Record<string, (t: Translations) => string> = {
  qa_bounce_rate: (t) => t.kpis.derived_qa_bounce,
  exec_failure_rate: (t) => t.kpis.derived_exec_failure,
  incident_rate: (t) => t.kpis.derived_incidents,
  parked_review_age_days: (t) => t.kpis.derived_parked_age,
};

/**
 * One human sentence describing HOW this KPI is measured. Never returns JSON
 * or raw tokens; unknown shapes degrade to a generic-but-honest sentence.
 */
export function describeMeasurement(kpi: DevKpi, t: Translations, tx: Tx): string {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(kpi.measure_config) as Record<string, unknown>;
  } catch {
    /* malformed config — fall through to generic sentences */
  }

  const cadence =
    kpi.cadence === 'daily'
      ? t.kpis.cadence_daily_adverb
      : kpi.cadence === 'weekly'
        ? t.kpis.cadence_weekly_adverb
        : t.kpis.cadence_manual_adverb;

  switch (kpi.measure_kind) {
    case 'codebase': {
      const cmd = typeof config.cmd === 'string' ? config.cmd : '';
      const parse = typeof config.parse === 'string' ? config.parse : '';
      return tx(t.kpis.describe_codebase, {
        cadence,
        tool: toolName(cmd, t),
        reads: readsWhat(parse, t),
      });
    }
    case 'derived': {
      const metric = typeof config.metric === 'string' ? config.metric : '';
      const sentence = DERIVED_SENTENCES[metric]?.(t);
      return sentence
        ? tx(t.kpis.describe_derived, { cadence, what: sentence })
        : tx(t.kpis.describe_derived_generic, { cadence });
    }
    case 'connector': {
      const service =
        (typeof config.connector === 'string' && config.connector) ||
        kpi.needed_connector ||
        '';
      return service
        ? tx(t.kpis.describe_connector, { cadence, service })
        : t.kpis.describe_connector_generic;
    }
    default:
      return t.kpis.describe_manual;
  }
}
