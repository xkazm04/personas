/**
 * Business-level schema compliance validators.
 * Each validator checks that a parsed output meets the structural
 * and semantic requirements the Rust backend expects.
 */
import type { QualityDimension } from './types';
import type {
  DesignOutput,
  CredentialDesignResult,
  HealthcheckResult,
  N8nTransformOutput,
  TransformQuestion,
  ParsedSection,
  TestScenario,
  PersonaExecutionResult,
  QueryDebugResult,
} from './businessParsers';

// ═══════════════════════════════════════════════════════════════════════════
// Shared helper
// ═══════════════════════════════════════════════════════════════════════════

function dim(name: string, weight: number, score: number, detail: string): QualityDimension {
  return { name, weight, score, detail };
}

function hasNonEmpty(obj: Record<string, unknown>, key: string): boolean {
  const val = obj[key];
  if (typeof val === 'string') return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return val !== undefined && val !== null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Persona Design Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateDesignResult(output: DesignOutput | null): QualityDimension[] {
  if (!output) {
    return [dim('Parseable', 3, 0, 'Could not parse design output from response')];
  }

  if (output.type === 'question') {
    return [
      dim('Parseable', 3, 1, 'Parsed as design question'),
      dim('Question Quality', 2, output.data.question.length > 10 ? 1 : 0.5, output.data.question.slice(0, 60)),
      dim('Has Options', 1, output.data.options.length >= 2 ? 1 : 0.3, `${output.data.options.length} options`),
    ];
  }

  const r = output.data;
  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, 'Successfully parsed design result JSON'),
  ];

  // structured_prompt fields
  const sp = r.structured_prompt;
  if (!sp) {
    dims.push(dim('Structured Prompt', 3, 0, 'Missing structured_prompt'));
    return dims;
  }

  const spFields = ['identity', 'instructions', 'toolGuidance', 'examples', 'errorHandling'] as const;
  let spScore = 0;
  for (const f of spFields) {
    if (typeof sp[f] === 'string' && sp[f].length > 5) spScore++;
  }
  dims.push(dim('Structured Prompt', 3, spScore / spFields.length,
    `${spScore}/${spFields.length} fields populated`));

  // full_prompt_markdown
  dims.push(dim('Full Prompt', 2,
    typeof r.full_prompt_markdown === 'string' && r.full_prompt_markdown.length > 50 ? 1 : 0,
    r.full_prompt_markdown ? `${r.full_prompt_markdown.length} chars` : 'Missing'));

  // summary
  dims.push(dim('Summary', 1,
    typeof r.summary === 'string' && r.summary.length > 10 ? 1 : 0,
    r.summary ? r.summary.slice(0, 60) : 'Missing'));

  // suggested_tools
  dims.push(dim('Suggested Tools', 1,
    Array.isArray(r.suggested_tools) && r.suggested_tools.length > 0 ? 1 : 0.3,
    `${r.suggested_tools?.length ?? 0} tools`));

  // suggested_triggers
  dims.push(dim('Suggested Triggers', 1,
    Array.isArray(r.suggested_triggers) && r.suggested_triggers.length > 0 ? 1 : 0.3,
    `${r.suggested_triggers?.length ?? 0} triggers`));

  // suggested_connectors with fields
  const connectors = r.suggested_connectors ?? [];
  const validConnectors = connectors.filter(c =>
    typeof c.name === 'string' &&
    typeof c.auth_type === 'string' &&
    Array.isArray(c.credential_fields) &&
    c.credential_fields.length > 0
  );
  dims.push(dim('Connectors', 2,
    connectors.length > 0 ? validConnectors.length / connectors.length : 0,
    `${validConnectors.length}/${connectors.length} valid connectors`));

  // use_case_flows
  const flows = r.use_case_flows ?? [];
  const validFlows = flows.filter(f =>
    typeof f.id === 'string' &&
    typeof f.name === 'string' &&
    Array.isArray(f.nodes) && f.nodes.length >= 2 &&
    Array.isArray(f.edges) && f.edges.length >= 1
  );
  dims.push(dim('Use Case Flows', 2,
    flows.length > 0 ? validFlows.length / flows.length : 0,
    `${validFlows.length}/${flows.length} valid flows (need 1-3)`));

  // Flow node types validation
  const validNodeTypes = new Set(['start', 'end', 'action', 'decision', 'connector', 'event', 'error']);
  if (flows.length > 0) {
    const allNodes = flows.flatMap(f => f.nodes ?? []);
    const validNodes = allNodes.filter(n => validNodeTypes.has(n.type));
    dims.push(dim('Node Types', 1,
      allNodes.length > 0 ? validNodes.length / allNodes.length : 0,
      `${validNodes.length}/${allNodes.length} valid node types`));
  }

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Credential Design Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateCredentialDesignResult(result: CredentialDesignResult | null): QualityDimension[] {
  if (!result) {
    return [dim('Parseable', 3, 0, 'Could not parse credential design output')];
  }

  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, 'Successfully parsed credential design JSON'),
  ];

  const c = result.connector;

  // connector.name — must be snake_case
  const isSnakeCase = /^[a-z][a-z0-9_]*$/.test(c.name);
  dims.push(dim('Connector Name', 2, isSnakeCase ? 1 : 0.3,
    `"${c.name}" ${isSnakeCase ? '(valid snake_case)' : '(not snake_case)'}`));

  // connector.label
  dims.push(dim('Connector Label', 1,
    typeof c.label === 'string' && c.label.length > 2 ? 1 : 0,
    c.label || 'Missing'));

  // fields — at least one, with proper types
  const validFieldTypes = new Set(['password', 'text']);
  const validFields = c.fields.filter(f =>
    typeof f.key === 'string' &&
    typeof f.label === 'string' &&
    validFieldTypes.has(f.type)
  );
  dims.push(dim('Credential Fields', 3,
    c.fields.length > 0 ? validFields.length / c.fields.length : 0,
    `${validFields.length}/${c.fields.length} valid fields`));

  // healthcheck_config
  const hc = c.healthcheck_config;
  if (hc) {
    const hasPlaceholder = JSON.stringify(hc.headers ?? {}).includes('{{');
    dims.push(dim('Healthcheck Config', 2,
      typeof hc.url === 'string' && typeof hc.method === 'string' && hc.expected_status ? 1 : 0.5,
      `${hc.method} ${hc.url?.slice(0, 40) ?? 'missing'}`));
    dims.push(dim('Healthcheck Placeholders', 1,
      hasPlaceholder ? 1 : 0,
      hasPlaceholder ? 'Uses {{field_key}} placeholders' : 'Missing placeholders'));
  } else {
    dims.push(dim('Healthcheck Config', 2, 0, 'Missing healthcheck_config'));
  }

  // setup_instructions
  dims.push(dim('Setup Instructions', 2,
    typeof result.setup_instructions === 'string' && result.setup_instructions.length > 20 ? 1 : 0,
    result.setup_instructions ? `${result.setup_instructions.length} chars` : 'Missing'));

  // summary
  dims.push(dim('Summary', 1,
    typeof result.summary === 'string' && result.summary.length > 5 ? 1 : 0,
    result.summary ? result.summary.slice(0, 60) : 'Missing'));

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Credential Healthcheck Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateHealthcheckResult(result: HealthcheckResult | null): QualityDimension[] {
  if (!result) {
    return [dim('Parseable', 3, 0, 'Could not parse healthcheck output')];
  }

  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, 'Successfully parsed healthcheck JSON'),
  ];

  if (result.skip) {
    dims.push(dim('Skip Reason', 2,
      typeof result.reason === 'string' && result.reason.length > 5 ? 1 : 0,
      result.reason?.slice(0, 60) ?? 'No reason'));
    return dims;
  }

  // endpoint
  dims.push(dim('Endpoint', 2,
    typeof result.endpoint === 'string' && result.endpoint.startsWith('http') ? 1 : 0,
    result.endpoint?.slice(0, 60) ?? 'Missing'));

  // method
  const validMethods = new Set(['GET', 'POST', 'PUT', 'HEAD', 'OPTIONS']);
  dims.push(dim('Method', 1,
    validMethods.has(result.method ?? '') ? 1 : 0,
    result.method ?? 'Missing'));

  // headers with placeholders
  const headersStr = JSON.stringify(result.headers ?? {});
  const hasPlaceholder = headersStr.includes('{{');
  dims.push(dim('Headers', 2,
    hasPlaceholder ? 1 : 0.3,
    hasPlaceholder ? 'Uses {{field_key}} placeholders' : 'No placeholders'));

  // expected_status
  dims.push(dim('Expected Status', 1,
    typeof result.expected_status === 'number' && result.expected_status >= 200 && result.expected_status < 300 ? 1 : 0,
    `Status: ${result.expected_status ?? 'missing'}`));

  // description
  dims.push(dim('Description', 1,
    typeof result.description === 'string' && result.description.length > 5 ? 1 : 0,
    result.description?.slice(0, 60) ?? 'Missing'));

  // Prefers identity/profile endpoint (no write)
  const endpoint = (result.endpoint ?? '').toLowerCase();
  const isReadOnly = !['post', 'put', 'patch', 'delete'].includes((result.method ?? '').toLowerCase()) ||
    /\/(me|profile|user|account|identity|whoami|verify)/i.test(endpoint);
  dims.push(dim('Read-Only Endpoint', 1,
    isReadOnly ? 1 : 0.5,
    isReadOnly ? 'Uses safe read endpoint' : 'May use write endpoint'));

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. N8N Transform Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateTransformOutput(output: N8nTransformOutput | null): QualityDimension[] {
  if (!output) {
    return [dim('Parseable', 3, 0, 'Could not parse n8n transform output')];
  }

  if (output.type === 'questions') {
    return validateTransformQuestions(output.data);
  }

  // Persona output
  const p = output.data;
  return [
    dim('Parseable', 3, 1, 'Parsed as persona output'),
    dim('Name', 1, typeof p.name === 'string' && p.name.length > 2 ? 1 : 0, p.name || 'Missing'),
    dim('Description', 1, typeof p.description === 'string' && p.description.length > 10 ? 1 : 0,
      p.description?.slice(0, 60) ?? 'Missing'),
    dim('System Prompt', 2, typeof p.system_prompt === 'string' && p.system_prompt.length > 50 ? 1 : 0,
      `${p.system_prompt?.length ?? 0} chars`),
    dim('Tools', 1, Array.isArray(p.tools) && p.tools.length > 0 ? 1 : 0.3,
      `${p.tools?.length ?? 0} tools`),
  ];
}

function validateTransformQuestions(questions: TransformQuestion[]): QualityDimension[] {
  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, `Parsed ${questions.length} transform questions`),
  ];

  // Must have at least one question
  dims.push(dim('Question Count', 1,
    questions.length >= 2 ? 1 : questions.length === 1 ? 0.5 : 0,
    `${questions.length} questions`));

  // Valid categories
  const validCategories = new Set(['credentials', 'configuration', 'human_in_the_loop', 'memory', 'notifications']);
  const categorized = questions.filter(q => validCategories.has(q.category));
  dims.push(dim('Valid Categories', 1,
    questions.length > 0 ? categorized.length / questions.length : 0,
    `${categorized.length}/${questions.length} valid categories`));

  // Valid types
  const validTypes = new Set(['select', 'text', 'boolean']);
  const typed = questions.filter(q => validTypes.has(q.type));
  dims.push(dim('Valid Types', 1,
    questions.length > 0 ? typed.length / questions.length : 0,
    `${typed.length}/${questions.length} valid types`));

  // Must include human_in_the_loop question
  const hasHitl = questions.some(q => q.category === 'human_in_the_loop');
  dims.push(dim('HITL Question', 2,
    hasHitl ? 1 : 0,
    hasHitl ? 'Has human-in-the-loop question' : 'Missing HITL question'));

  // Must include memory question
  const hasMemory = questions.some(q => q.category === 'memory');
  dims.push(dim('Memory Question', 2,
    hasMemory ? 1 : 0,
    hasMemory ? 'Has memory strategy question' : 'Missing memory question'));

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Section-Delimited Output Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateSections(sections: ParsedSection[]): QualityDimension[] {
  if (sections.length === 0) {
    return [dim('Parseable', 3, 0, 'No sections found in output')];
  }

  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, `Parsed ${sections.length} sections`),
  ];

  // Required sections
  const requiredSections: SectionCheck[] = [
    { type: 'identity', required: ['name'], label: 'Identity' },
    { type: 'prompt', required: ['system_prompt'], label: 'Prompt' },
    { type: 'design_context', required: ['summary'], label: 'Design Context' },
    { type: 'end', required: [], label: 'End Marker' },
  ];

  for (const req of requiredSections) {
    const section = sections.find(s => s.type === req.type);
    if (!section) {
      dims.push(dim(req.label, 2, 0, `Missing ---SECTION:${req.type}---`));
      continue;
    }
    if (req.required.length === 0) {
      dims.push(dim(req.label, 1, 1, 'Present'));
      continue;
    }
    const hasAll = req.required.every(k => hasNonEmpty(section.data, k));
    dims.push(dim(req.label, 2, hasAll ? 1 : 0.5,
      hasAll ? `Has ${req.required.join(', ')}` : `Missing: ${req.required.filter(k => !hasNonEmpty(section.data, k)).join(', ')}`));
  }

  // Optional repeated sections
  const tools = sections.filter(s => s.type === 'tool');
  dims.push(dim('Tools', 1,
    tools.length > 0 ? 1 : 0.3,
    `${tools.length} tool sections`));

  const triggers = sections.filter(s => s.type === 'trigger');
  dims.push(dim('Triggers', 1,
    triggers.length > 0 ? 1 : 0.3,
    `${triggers.length} trigger sections`));

  const connectors = sections.filter(s => s.type === 'connector');
  dims.push(dim('Connectors', 1,
    connectors.length > 0 ? 1 : 0.3,
    `${connectors.length} connector sections`));

  return dims;
}

interface SectionCheck {
  type: string;
  required: string[];
  label: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Test Scenario Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateTestScenarios(
  scenarios: TestScenario[] | null,
  availableTools: string[],
): QualityDimension[] {
  if (!scenarios) {
    return [dim('Parseable', 3, 0, 'Could not parse test scenarios')];
  }

  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, `Parsed ${scenarios.length} scenarios`),
  ];

  // Count (3-5)
  dims.push(dim('Scenario Count', 1,
    scenarios.length >= 3 && scenarios.length <= 5 ? 1 :
      scenarios.length >= 1 ? 0.5 : 0,
    `${scenarios.length} scenarios (expected 3-5)`));

  // Each must have required fields
  const complete = scenarios.filter(s =>
    typeof s.name === 'string' &&
    typeof s.description === 'string' &&
    typeof s.expected_behavior === 'string' &&
    Array.isArray(s.mock_tools) &&
    Array.isArray(s.expected_tool_sequence)
  );
  dims.push(dim('Schema Compliance', 2,
    scenarios.length > 0 ? complete.length / scenarios.length : 0,
    `${complete.length}/${scenarios.length} complete schemas`));

  // mock_tools reference valid tools
  if (availableTools.length > 0) {
    const toolSet = new Set(availableTools.map(t => t.toLowerCase()));
    const allMocks = scenarios.flatMap(s => s.mock_tools ?? []);
    const validMocks = allMocks.filter(m => toolSet.has(m.tool_name?.toLowerCase()));
    dims.push(dim('Valid Mock Tools', 2,
      allMocks.length > 0 ? validMocks.length / allMocks.length : 0.5,
      `${validMocks.length}/${allMocks.length} reference available tools`));
  }

  // Has at least one happy path and one error/edge case
  const descriptions = scenarios.map(s => (s.description + ' ' + s.name).toLowerCase());
  const hasHappy = descriptions.some(d =>
    d.includes('happy') || d.includes('success') || d.includes('normal') || d.includes('primary') || d.includes('standard'));
  const hasEdge = descriptions.some(d =>
    d.includes('error') || d.includes('edge') || d.includes('fail') || d.includes('invalid') || d.includes('missing') || d.includes('empty'));
  dims.push(dim('Scenario Diversity', 2,
    hasHappy && hasEdge ? 1 : hasHappy || hasEdge ? 0.5 : 0.3,
    `Happy path: ${hasHappy ? 'yes' : 'no'}, Edge case: ${hasEdge ? 'yes' : 'no'}`));

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Persona Execution Validator — protocol compliance
// ═══════════════════════════════════════════════════════════════════════════

export function validatePersonaExecutionResult(result: PersonaExecutionResult): QualityDimension[] {
  const dims: QualityDimension[] = [];

  // Outcome Assessment (REQUIRED protocol)
  if (result.outcomeAssessment) {
    dims.push(dim('Outcome Assessment', 3, 1, 'Present'));
    dims.push(dim('Accomplished Flag', 2,
      typeof result.outcomeAssessment.accomplished === 'boolean' ? 1 : 0,
      `accomplished: ${result.outcomeAssessment.accomplished}`));
    dims.push(dim('OA Summary', 1,
      result.outcomeAssessment.summary.length > 5 ? 1 : 0,
      result.outcomeAssessment.summary.slice(0, 60) || 'Empty'));
    dims.push(dim('OA Blockers', 1,
      Array.isArray(result.outcomeAssessment.blockers) ? 1 : 0,
      `${result.outcomeAssessment.blockers?.length ?? 0} blockers`));
  } else {
    dims.push(dim('Outcome Assessment', 3, 0, 'Missing outcome_assessment (REQUIRED protocol)'));
  }

  // User Messages (optional but expected)
  dims.push(dim('User Messages', 2,
    result.userMessages.length > 0 ? 1 : 0.3,
    `${result.userMessages.length} user_message protocols`));

  // Validate user message fields
  if (result.userMessages.length > 0) {
    const validPriorities = new Set(['low', 'normal', 'high', 'critical']);
    const validContentTypes = new Set(['text', 'markdown']);
    const wellFormed = result.userMessages.filter(m =>
      typeof m.title === 'string' && m.title.length > 0 &&
      typeof m.content === 'string' && m.content.length > 0 &&
      validContentTypes.has(m.content_type) &&
      validPriorities.has(m.priority)
    );
    dims.push(dim('Message Schema', 1,
      wellFormed.length / result.userMessages.length,
      `${wellFormed.length}/${result.userMessages.length} well-formed messages`));
  }

  // Agent Memory (optional)
  if (result.agentMemories.length > 0) {
    const validCategories = new Set(['fact', 'preference', 'instruction', 'context', 'learned']);
    const wellFormed = result.agentMemories.filter(m =>
      typeof m.title === 'string' && m.title.length > 0 &&
      typeof m.content === 'string' && m.content.length > 0 &&
      validCategories.has(m.category) &&
      typeof m.importance === 'number' && m.importance >= 1 && m.importance <= 10
    );
    dims.push(dim('Agent Memory', 1,
      wellFormed.length / result.agentMemories.length,
      `${wellFormed.length}/${result.agentMemories.length} well-formed memories`));
  }

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Template Adoption Validator — reuses transform validation
// ═══════════════════════════════════════════════════════════════════════════

// Template adoption uses the same output format as N8N transform.
export const validateTemplateAdoptResult = validateTransformOutput;

// ═══════════════════════════════════════════════════════════════════════════
// 9. Query Debug Validator
// ═══════════════════════════════════════════════════════════════════════════

export function validateQueryDebugResult(
  result: QueryDebugResult | null,
  originalQuery: string,
): QualityDimension[] {
  if (!result) {
    return [dim('Parseable', 3, 0, 'Could not extract corrected query from response')];
  }

  const dims: QualityDimension[] = [
    dim('Parseable', 3, 1, 'Extracted code block from response'),
  ];

  // Corrected query is non-empty
  dims.push(dim('Query Present', 2,
    result.correctedQuery.trim().length > 10 ? 1 : 0,
    `${result.correctedQuery.length} chars`));

  // Language detected
  const validLangs = new Set(['sql', 'mysql', 'postgresql', 'postgres', 'sqlite', 'redis', 'mongodb']);
  dims.push(dim('Language Tag', 1,
    validLangs.has(result.language) ? 1 : result.language ? 0.5 : 0,
    `Language: ${result.language || 'none'}`));

  // Query differs from original (actually fixed something)
  const normalized = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const isDifferent = normalized(result.correctedQuery) !== normalized(originalQuery);
  dims.push(dim('Actually Fixed', 2,
    isDifferent ? 1 : 0,
    isDifferent ? 'Query was modified' : 'Query unchanged'));

  // Has explanation
  dims.push(dim('Explanation', 1,
    result.explanation.length > 20 ? 1 : result.explanation.length > 0 ? 0.5 : 0,
    `${result.explanation.length} chars of explanation`));

  // No JS/TS code in corrected query (the backend explicitly rejects these)
  const hasJsCode = /\b(const|let|var|import|require|async|await|function)\b/.test(result.correctedQuery);
  dims.push(dim('Pure SQL', 2,
    hasJsCode ? 0 : 1,
    hasJsCode ? 'Contains JavaScript/TypeScript code' : 'Pure database query'));

  // Corrected query contains key SQL keywords (sanity check)
  const hasSqlKeywords = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN)\b/i.test(result.correctedQuery);
  dims.push(dim('SQL Keywords', 1,
    hasSqlKeywords ? 1 : 0.3,
    hasSqlKeywords ? 'Contains SQL keywords' : 'Missing SQL keywords'));

  return dims;
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregate scoring
// ═══════════════════════════════════════════════════════════════════════════

export function scoreDimensions(dims: QualityDimension[]): {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
} {
  const totalWeight = dims.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = dims.reduce((sum, d) => sum + d.score * d.weight, 0);
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    overallScore >= 0.9 ? 'A' :
      overallScore >= 0.75 ? 'B' :
        overallScore >= 0.6 ? 'C' :
          overallScore >= 0.4 ? 'D' : 'F';

  return { overallScore, grade };
}
