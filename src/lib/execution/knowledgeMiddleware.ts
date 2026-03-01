/**
 * Knowledge Injection Pipeline Middleware
 *
 * Registers a pipeline middleware at the `validate` stage that queries the
 * execution knowledge graph and attaches learned guidance to the payload.
 * This enriches the execution with fleet intelligence accumulated from all
 * prior runs — tool sequence preferences, known failure patterns, and
 * cost-quality tradeoffs.
 */

import { getKnowledgeInjection } from '@/api/knowledge';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import {
  addMiddleware,
  type PipelineMiddleware,
} from '@/lib/execution/pipeline';

/** Compile knowledge entries into a compact guidance string for the prompt. */
function compileGuidance(entries: ExecutionKnowledge[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['[Knowledge Graph Guidance]'];

  const toolSeqs = entries.filter((e) => e.knowledge_type === 'tool_sequence' && e.confidence >= 0.7);
  if (toolSeqs.length > 0) {
    lines.push('Preferred tool sequences:');
    for (const ts of toolSeqs.slice(0, 3)) {
      const rate = Math.round(ts.confidence * 100);
      lines.push(`  - ${ts.pattern_key} (${rate}% success, avg $${ts.avg_cost_usd.toFixed(4)})`);
    }
  }

  const failures = entries.filter((e) => e.knowledge_type === 'failure_pattern');
  if (failures.length > 0) {
    lines.push('Known failure patterns to avoid:');
    for (const f of failures.slice(0, 3)) {
      try {
        const data = JSON.parse(f.pattern_data) as { sample_error?: string };
        lines.push(`  - ${data.sample_error?.slice(0, 80) ?? f.pattern_key}`);
      } catch {
        lines.push(`  - ${f.pattern_key}`);
      }
    }
  }

  const models = entries.filter((e) => e.knowledge_type === 'model_performance' && e.confidence >= 0.6);
  if (models.length > 0) {
    lines.push('Model performance insights:');
    for (const m of models.slice(0, 2)) {
      const rate = Math.round(m.confidence * 100);
      lines.push(`  - ${m.pattern_key}: ${rate}% success, avg ${Math.round(m.avg_duration_ms)}ms`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

/** The validate-stage middleware that enriches payload with knowledge. */
const knowledgeInjectionMiddleware: PipelineMiddleware<'validate'> = async (
  _stage,
  payload,
  _trace,
) => {
  try {
    const entries = await getKnowledgeInjection(payload.personaId, payload.useCaseId ?? undefined);

    if (entries.length > 0) {
      const guidance = compileGuidance(entries);
      if (guidance) {
        // Attach guidance as metadata — the execution hook can access this
        // to prepend to the prompt or include in the input data.
        return {
          ...payload,
          inputData: payload.inputData
            ? `${payload.inputData}\n\n${guidance}`
            : guidance,
        };
      }
    }
  } catch {
    // Non-blocking: if knowledge query fails, continue without injection
  }

  return payload;
};

/** Register the knowledge injection middleware. Call once at app startup. */
export function registerKnowledgeMiddleware(): void {
  addMiddleware('validate', knowledgeInjectionMiddleware);
}
