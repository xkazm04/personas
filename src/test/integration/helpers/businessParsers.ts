/**
 * TypeScript ports of the Rust output parsers.
 * These validate that CLI responses can be parsed by the app's actual parsing logic.
 *
 * Mirrors:
 *   - engine/design.rs           → extractDesignResult
 *   - engine/credential_design.rs → extractCredentialDesignResult, extractHealthcheckResult
 *   - n8n_transform/prompts.rs   → extractTransformQuestions, parseSections
 *   - engine/test_runner.rs      → parseTestScenarios
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Extract the first JSON block from text (inside ```json ... ``` or bare). */
function extractJsonBlock(text: string): unknown | null {
  // Try fenced code block first
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(text);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  // Try bare JSON (first { to last })
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }

  // Try array
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1));
    } catch {
      // fall through
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Persona Design — mirrors extract_design_result()
// ═══════════════════════════════════════════════════════════════════════════

export interface DesignResult {
  structured_prompt: {
    identity: string;
    instructions: string;
    toolGuidance: string;
    examples: string;
    errorHandling: string;
    webSearch?: string;
    customSections?: Array<{ title: string; content: string }>;
  };
  suggested_tools: string[];
  suggested_triggers: Array<{
    trigger_type: string;
    config: Record<string, unknown>;
    description: string;
  }>;
  full_prompt_markdown: string;
  summary: string;
  suggested_connectors: Array<{
    name: string;
    label: string;
    auth_type: string;
    credential_fields: Array<{
      key: string;
      label: string;
      type: string;
      placeholder?: string;
      helpText?: string;
      required?: boolean;
    }>;
    setup_instructions: string;
  }>;
  use_case_flows: Array<{
    id: string;
    name: string;
    description: string;
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ id: string; source: string; target: string }>;
  }>;
}

export interface DesignQuestion {
  question: string;
  options: string[];
  context: string;
}

export type DesignOutput =
  | { type: 'result'; data: DesignResult }
  | { type: 'question'; data: DesignQuestion };

export function extractDesignResult(text: string): DesignOutput | null {
  const json = extractJsonBlock(text);
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;

  // Check for design_question
  if (obj.design_question && typeof obj.design_question === 'object') {
    const dq = obj.design_question as Record<string, unknown>;
    if (typeof dq.question === 'string') {
      return {
        type: 'question',
        data: {
          question: dq.question,
          options: Array.isArray(dq.options) ? dq.options : [],
          context: typeof dq.context === 'string' ? dq.context : '',
        },
      };
    }
  }

  // Check for design result
  if (obj.structured_prompt && typeof obj.structured_prompt === 'object') {
    return { type: 'result', data: obj as unknown as DesignResult };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Credential Design — mirrors extract_credential_design_result()
// ═══════════════════════════════════════════════════════════════════════════

export interface CredentialDesignResult {
  match_existing: string | null;
  connector: {
    name: string;
    label: string;
    category?: string;
    color?: string;
    oauth_type?: string | null;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      placeholder?: string;
      helpText?: string;
    }>;
    healthcheck_config?: {
      url: string;
      method: string;
      headers: Record<string, string>;
      expected_status: number;
      description: string;
    };
    services?: unknown[];
    events?: unknown[];
  };
  setup_instructions: string;
  summary: string;
}

export function extractCredentialDesignResult(text: string): CredentialDesignResult | null {
  const json = extractJsonBlock(text);
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;
  if (!obj.connector || typeof obj.connector !== 'object') return null;

  const connector = obj.connector as Record<string, unknown>;
  if (typeof connector.name !== 'string') return null;
  if (!Array.isArray(connector.fields)) return null;

  return obj as unknown as CredentialDesignResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Credential Healthcheck — mirrors extract_healthcheck_result()
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthcheckResult {
  skip: boolean;
  reason?: string | null;
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  expected_status?: number;
  description?: string;
}

export function extractHealthcheckResult(text: string): HealthcheckResult | null {
  const json = extractJsonBlock(text);
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;
  if (typeof obj.skip !== 'boolean') return null;

  if (!obj.skip) {
    if (typeof obj.endpoint !== 'string') return null;
    if (typeof obj.method !== 'string') return null;
  }

  return obj as unknown as HealthcheckResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. N8N Transform Questions — mirrors extract_questions_output()
// ═══════════════════════════════════════════════════════════════════════════

export interface TransformQuestion {
  id: string;
  category: string;
  question: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
}

export interface TransformPersona {
  name: string;
  description: string;
  system_prompt: string;
  structured_prompt?: Record<string, unknown>;
  tools?: string[];
  triggers?: unknown[];
  required_connectors?: unknown[];
}

export type N8nTransformOutput =
  | { type: 'questions'; data: TransformQuestion[] }
  | { type: 'persona'; data: TransformPersona };

export function extractTransformOutput(text: string): N8nTransformOutput | null {
  // Check for TRANSFORM_QUESTIONS marker
  const questionsIdx = text.indexOf('TRANSFORM_QUESTIONS');
  if (questionsIdx !== -1) {
    const afterMarker = text.slice(questionsIdx + 'TRANSFORM_QUESTIONS'.length);
    const arrStart = afterMarker.indexOf('[');
    const arrEnd = afterMarker.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try {
        const questions = JSON.parse(afterMarker.slice(arrStart, arrEnd + 1));
        if (Array.isArray(questions) && questions.length > 0) {
          return { type: 'questions', data: questions as TransformQuestion[] };
        }
      } catch {
        // fall through
      }
    }
  }

  // Check for persona JSON
  const json = extractJsonBlock(text);
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (obj.persona && typeof obj.persona === 'object') {
      return { type: 'persona', data: obj.persona as TransformPersona };
    }
    // Direct persona object
    if (typeof obj.name === 'string' && typeof obj.system_prompt === 'string') {
      return { type: 'persona', data: obj as unknown as TransformPersona };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Section-Delimited Output — mirrors SectionAccumulator / parse_persona_output()
// ═══════════════════════════════════════════════════════════════════════════

export type SectionType = 'identity' | 'prompt' | 'tool' | 'trigger' | 'connector' | 'design_context' | 'end';

export interface ParsedSection {
  type: SectionType;
  data: Record<string, unknown>;
}

export function parseSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const delimiter = /---SECTION:(\w+)---/g;
  let match: RegExpExecArray | null;
  const markers: Array<{ type: string; index: number }> = [];

  while ((match = delimiter.exec(text)) !== null) {
    markers.push({ type: match[1], index: match.index + match[0].length });
  }

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker.type === 'end') {
      sections.push({ type: 'end', data: {} });
      continue;
    }

    const nextIdx = i + 1 < markers.length ? markers[i + 1].index - `---SECTION:${markers[i + 1].type}---`.length : text.length;
    const content = text.slice(marker.index, nextIdx).trim();

    const json = extractJsonBlock(content);
    if (json && typeof json === 'object') {
      sections.push({
        type: marker.type as SectionType,
        data: json as Record<string, unknown>,
      });
    }
  }

  return sections;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Test Scenarios — mirrors parse_scenarios_from_output()
// ═══════════════════════════════════════════════════════════════════════════

export interface TestScenario {
  name: string;
  description: string;
  input_data: Record<string, unknown>;
  mock_tools: Array<{
    tool_name: string;
    description: string;
    mock_response: Record<string, unknown>;
  }>;
  expected_behavior: string;
  expected_tool_sequence: string[];
  expected_protocols: string[];
}

export function parseTestScenarios(text: string): TestScenario[] | null {
  const json = extractJsonBlock(text);
  if (!Array.isArray(json)) return null;
  if (json.length === 0) return null;

  // Validate at least the first entry has required fields
  const first = json[0];
  if (typeof first !== 'object' || !first) return null;
  if (typeof first.name !== 'string') return null;
  if (typeof first.description !== 'string') return null;

  return json as TestScenario[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Persona Execution — mirrors engine/parser.rs protocol extraction
// ═══════════════════════════════════════════════════════════════════════════

export interface OutcomeAssessment {
  accomplished: boolean;
  summary: string;
  blockers: string[];
}

export interface UserMessage {
  title: string;
  content: string;
  content_type: 'text' | 'markdown';
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface AgentMemory {
  title: string;
  content: string;
  category: 'fact' | 'preference' | 'instruction' | 'context' | 'learned';
  importance: number;
  tags: string[];
}

export interface PersonaExecutionResult {
  outcomeAssessment: OutcomeAssessment | null;
  userMessages: UserMessage[];
  agentMemories: AgentMemory[];
}

export function extractPersonaExecutionResult(text: string): PersonaExecutionResult {
  const result: PersonaExecutionResult = {
    outcomeAssessment: null,
    userMessages: [],
    agentMemories: [],
  };

  // Scan for protocol JSON lines
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      if (obj.outcome_assessment && typeof obj.outcome_assessment === 'object') {
        const oa = obj.outcome_assessment as Record<string, unknown>;
        result.outcomeAssessment = {
          accomplished: Boolean(oa.accomplished),
          summary: typeof oa.summary === 'string' ? oa.summary : '',
          blockers: Array.isArray(oa.blockers) ? oa.blockers.map(String) : [],
        };
      }

      if (obj.user_message && typeof obj.user_message === 'object') {
        const um = obj.user_message as Record<string, unknown>;
        if (typeof um.title === 'string' && typeof um.content === 'string') {
          result.userMessages.push(um as unknown as UserMessage);
        }
      }

      if (obj.agent_memory && typeof obj.agent_memory === 'object') {
        const am = obj.agent_memory as Record<string, unknown>;
        if (typeof am.title === 'string' && typeof am.content === 'string') {
          result.agentMemories.push(am as unknown as AgentMemory);
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Also try extracting from fenced code blocks or inline JSON
  if (!result.outcomeAssessment) {
    const outcomeMatch = /\{"outcome_assessment"\s*:\s*\{[^}]*"accomplished"\s*:\s*(true|false)[^}]*\}\s*\}/.exec(text);
    if (outcomeMatch) {
      try {
        const obj = JSON.parse(outcomeMatch[0]) as { outcome_assessment: OutcomeAssessment };
        result.outcomeAssessment = obj.outcome_assessment;
      } catch {
        // skip
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Template Adoption — reuses extractTransformOutput + TransformPersona
//    (same TRANSFORM_QUESTIONS / persona JSON dual format as n8n transform)
// ═══════════════════════════════════════════════════════════════════════════

// Template adoption uses the same output format as N8N transform.
// Re-export extractTransformOutput for use as extractTemplateAdoptResult.
export const extractTemplateAdoptResult = extractTransformOutput;

// ═══════════════════════════════════════════════════════════════════════════
// 9. Query Debug — mirrors query_debug.rs extract_code_block()
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryDebugResult {
  correctedQuery: string;
  language: string;
  explanation: string;
}

export function extractQueryDebugResult(text: string): QueryDebugResult | null {
  // Look for fenced code blocks
  const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)\n\s*```/g;
  let bestMatch: { query: string; lang: string } | null = null;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const content = match[2].trim();

    // Prefer SQL blocks, skip JS/TS/Python blocks
    if (['javascript', 'typescript', 'js', 'ts', 'python', 'py'].includes(lang)) {
      continue;
    }

    if (['sql', 'mysql', 'postgresql', 'postgres', 'sqlite', 'redis', 'mongodb'].includes(lang)) {
      bestMatch = { query: content, lang };
      break; // Prefer language-specific match
    }

    if (!bestMatch) {
      bestMatch = { query: content, lang: lang || 'sql' };
    }
  }

  if (!bestMatch) return null;

  // Extract explanation (text outside code blocks)
  const explanation = text
    .replace(/```[\s\S]*?```/g, '')
    .trim()
    .split('\n')
    .filter(l => l.trim().length > 0)
    .join('\n');

  return {
    correctedQuery: bestMatch.query,
    language: bestMatch.lang,
    explanation,
  };
}
