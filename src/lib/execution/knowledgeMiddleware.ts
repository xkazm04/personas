/**
 * Knowledge Injection Pipeline Middleware
 *
 * Registers a pipeline middleware at the `validate` stage that queries the
 * execution knowledge graph and attaches learned guidance to the payload.
 * This enriches the execution with fleet intelligence accumulated from all
 * prior runs -- tool sequence preferences, known failure patterns, and
 * cost-quality tradeoffs.
 */

import { getKnowledgeInjection } from '@/api/overview/intelligence/knowledge';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import {
  addMiddleware,
  type PipelineMiddleware,
} from '@/lib/execution/pipeline';
import { createLogger } from '@/lib/log';
import { extractMessage } from '@/lib/silentCatch';

const logger = createLogger("knowledge-middleware");

/** Compile knowledge entries into a compact guidance string for the prompt. */
function compileGuidance(entries: ExecutionKnowledge[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['[Knowledge Graph Guidance]'];

  const toolSeqs = entries.filter((e) => e.knowledge_type === 'tool_sequence' && e.confidence >= 0.7);
  if (toolSeqs.length > 0) {
    lines.push('Preferred tool sequences:');
    for (const ts of toolSeqs.slice(0, 3)) {
      const rate = Math.round(ts.confidence * 100);
      // Say "cost unknown" rather than "$0.0000": the line is read by the
      // model and a fabricated zero is a fact it will reason from.
      const cost =
        ts.avg_cost_usd != null ? `avg $${ts.avg_cost_usd.toFixed(4)}` : 'cost unknown';
      lines.push(`  - ${ts.pattern_key} (${rate}% success, ${cost})`);
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
        // intentional: non-critical -- JSON parse fallback
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

/** The input_data key the guidance travels under. */
const KNOWLEDGE_GUIDANCE_KEY = 'knowledge_guidance';

/**
 * Put the guidance INSIDE the input_data JSON object, or return null when the
 * input is not an object it can be added to.
 *
 * `inputData` is a JSON string that `execute_persona` parses: with a use case
 * it rejects anything that is not a JSON object ("input_data is not valid
 * JSON"), without one it wraps unparseable text as `{ user_input }`. This
 * middleware used to append the guidance as raw text after the JSON, so every
 * use-case run of a persona with learned knowledge failed before it started,
 * and every other run lost its structured input into one string. A
 * non-underscore key keeps the guidance in the `## Input Data` dump the model
 * reads (underscore keys are internal metadata the assembler skips).
 */
function withGuidance(inputData: string | null, guidance: string): string | null {
  if (!inputData || inputData.trim().length === 0) {
    return JSON.stringify({ [KNOWLEDGE_GUIDANCE_KEY]: guidance });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputData);
  } catch {
    // intentional: not JSON -- leave the caller's input exactly as it was
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  // Invariant: the guard above leaves only a plain JSON object.
  return JSON.stringify({ ...(parsed as Record<string, unknown>), [KNOWLEDGE_GUIDANCE_KEY]: guidance });
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
      const inputData = guidance ? withGuidance(payload.inputData, guidance) : null;
      if (inputData) return { ...payload, inputData };
    }
  } catch (err) {
    logger.warn('Knowledge injection failed, continuing without', { personaId: payload.personaId, error: extractMessage(err) });
  }

  return payload;
};

/** Register the knowledge injection middleware. Call once at app startup. */
export function registerKnowledgeMiddleware(): void {
  addMiddleware('validate', 'knowledge-injection', knowledgeInjectionMiddleware);
}
