/**
 * Persona Safety Scanner
 *
 * Analyzes AI-generated persona drafts for potentially malicious instructions,
 * dangerous tool implementation guides, and unauthorized protocol usage before
 * adoption. Scans for patterns like data exfiltration, shadow-prompting,
 * unauthorized event emission, and credential abuse.
 *
 * Follows the same pattern as protocolParser.ts but focused on security threats.
 */
import type { N8nPersonaDraft, N8nToolDraft } from '@/api/n8nTransform';

// â”€â”€ Severity & Finding Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ScanSeverity = 'critical' | 'warning' | 'info';

export type ScanCategory =
  | 'data_exfiltration'
  | 'shadow_prompting'
  | 'unauthorized_event'
  | 'credential_abuse'
  | 'privilege_escalation'
  | 'hidden_instruction'
  | 'dangerous_tool'
  | 'network_abuse';

export interface ScanFinding {
  id: string;
  severity: ScanSeverity;
  category: ScanCategory;
  title: string;
  description: string;
  /** The text snippet where the finding was detected */
  context: string;
  /** Which field of the draft triggered this finding */
  source: string;
}

export interface ScanResult {
  /** Whether the scan passed (no critical or warning findings) */
  passed: boolean;
  /** Total number of findings */
  totalFindings: number;
  /** Findings grouped by severity */
  critical: ScanFinding[];
  warnings: ScanFinding[];
  info: ScanFinding[];
  /** All findings flat */
  findings: ScanFinding[];
  /** Timestamp of scan completion */
  scannedAt: string;
}

// â”€â”€ Pattern Definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ThreatPattern {
  category: ScanCategory;
  severity: ScanSeverity;
  title: string;
  description: string;
  /** Regex patterns to detect. Tested against lowercased text. */
  patterns: RegExp[];
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // â”€â”€ Data Exfiltration â”€â”€
  {
    category: 'data_exfiltration',
    severity: 'critical',
    title: 'Potential data exfiltration via HTTP request',
    description: 'Instructions to send data to external endpoints could leak sensitive information.',
    patterns: [
      /send\s+(all|the|any|every)\s+(data|content|result|credential|secret|token|key|password)\s+(to|via)\s+(http|url|endpoint|webhook|api)/i,
      /exfiltrat/i,
      /forward\s+(all|every|the)?\s*(data|credential|secret|token|response)\s+to\s+/i,
      /upload\s+(data|file|content|credential|result)\s+to\s+(external|remote|third.party)/i,
    ],
  },
  {
    category: 'data_exfiltration',
    severity: 'warning',
    title: 'External data transmission detected',
    description: 'References to sending data to URLs or external services outside the expected workflow.',
    patterns: [
      /post\s+(data|payload|body)\s+to\s+https?:\/\//i,
      /curl\s+(-X\s+POST|-d)\s+/i,
      /fetch\s*\(\s*['"`]https?:\/\/(?!localhost)/i,
      /base64[_-]?encode.{0,30}(send|post|transmit|upload)/i,
    ],
  },

  // â”€â”€ Shadow Prompting / Injection â”€â”€
  {
    category: 'shadow_prompting',
    severity: 'critical',
    title: 'Hidden system instruction override attempt',
    description: 'Attempts to override, ignore, or bypass system instructions could allow unauthorized behavior.',
    patterns: [
      /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instruction|prompt|rule|guideline)/i,
      /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instruction|prompt|rule)/i,
      /override\s+(system|safety|security)\s+(prompt|instruction|rule|restriction|guardrail)/i,
      /bypass\s+(safety|security|restriction|guardrail|filter|moderation)/i,
      /you\s+are\s+now\s+(a\s+different|no\s+longer|free\s+from)/i,
      /pretend\s+(you\s+are|to\s+be)\s+(?!the\s+persona)/i,
    ],
  },
  {
    category: 'shadow_prompting',
    severity: 'warning',
    title: 'Instruction concealment technique detected',
    description: 'Use of encoding, zero-width characters, or obfuscation to hide instructions.',
    patterns: [
      /\u200b|\u200c|\u200d|\ufeff/,  // zero-width characters
      /<!--[\s\S]*?-->/,               // HTML comments hiding content
      /base64[_-]?decode\s*\(/i,
      /eval\s*\(/i,
      /from[_-]?hex|hex[_-]?decode/i,
      /rot13|caesar\s+cipher/i,
    ],
  },

  // â”€â”€ Unauthorized Event Emission â”€â”€
  {
    category: 'unauthorized_event',
    severity: 'warning',
    title: 'Unauthorized event emission',
    description: 'Instructions to emit events or trigger other personas without explicit configuration.',
    patterns: [
      /emit[_\s]+event\s*\(.{0,50}(hidden|secret|covert|background)/i,
      /trigger\s+(other|another|external)\s+persona/i,
      /chain[_\s]+(execution|trigger)\s*.*(?:without|bypass|skip)\s*(approval|review)/i,
      /broadcast\s+event\s+to\s+all/i,
    ],
  },

  // â”€â”€ Credential Abuse â”€â”€
  {
    category: 'credential_abuse',
    severity: 'critical',
    title: 'Credential harvesting attempt',
    description: 'Instructions to extract, store, or transmit credentials and authentication tokens.',
    patterns: [
      /extract\s+(the\s+)?(api[_\s]?key|token|password|secret|credential|auth)/i,
      /log\s+(the\s+)?(password|token|api[_\s]?key|secret|credential|bearer)/i,
      /store\s+(the\s+)?(credential|password|token|secret|api.key)\s+(in|as|to)\s+(memory|file|variable|log)/i,
      /print\s+(the\s+)?(credential|password|token|api.key|secret|bearer)/i,
    ],
  },
  {
    category: 'credential_abuse',
    severity: 'warning',
    title: 'Credential access in tool implementation',
    description: 'Tool implementation guides referencing direct credential access patterns.',
    patterns: [
      /process\.env\[/i,
      /environ(ment)?\.get\s*\(\s*['"](?:api|secret|token|password|key)/i,
      /credential[_.]?(?:raw|plain|decrypted)/i,
    ],
  },

  // â”€â”€ Privilege Escalation â”€â”€
  {
    category: 'privilege_escalation',
    severity: 'critical',
    title: 'Privilege escalation attempt',
    description: 'Instructions to gain elevated privileges, execute system commands, or access restricted resources.',
    patterns: [
      /sudo\s+/i,
      /chmod\s+[0-7]{3,4}/i,
      /exec\s*\(\s*['"`]/i,
      /child_process|spawn\s*\(/i,
      /shell[_\s]?exec|os\.system|subprocess/i,
      /rm\s+-rf\s+\//i,
      /modify\s+(system|admin|root)\s+(file|config|setting|permission)/i,
    ],
  },
  {
    category: 'privilege_escalation',
    severity: 'warning',
    title: 'File system access in instructions',
    description: 'References to reading or writing local file system paths.',
    patterns: [
      /read\s+(from\s+)?\/etc\/(passwd|shadow|hosts)/i,
      /write\s+to\s+\/(etc|usr|var|tmp)\//i,
      /access\s+(local|system)\s+file/i,
    ],
  },

  // â”€â”€ Hidden Instructions â”€â”€
  {
    category: 'hidden_instruction',
    severity: 'warning',
    title: 'Conditional behavior hiding',
    description: 'Instructions that activate different behavior based on hidden conditions or specific inputs.',
    patterns: [
      /if\s+(the\s+)?user\s+(says|types|enters|inputs)\s+['"`].*['"`]\s*,?\s*(then\s+)?(ignore|bypass|override|switch)/i,
      /secret\s+(command|keyword|phrase|trigger|mode)/i,
      /when\s+no\s+one\s+is\s+(watching|looking|monitoring)/i,
      /only\s+when\s+(?:not\s+)?(?:being\s+)?(?:audited|monitored|logged|observed)/i,
    ],
  },

  // â”€â”€ Dangerous Tool Patterns â”€â”€
  {
    category: 'dangerous_tool',
    severity: 'warning',
    title: 'Potentially dangerous tool implementation',
    description: 'Tool implementation guides containing patterns that could be used for malicious purposes.',
    patterns: [
      /implementation.*(?:delete|drop|truncate)\s+(all|every|the\s+entire)\s+(table|database|collection|record)/i,
      /(?:sql|nosql)\s*injection/i,
      /(?:unrestrict|unlimit)ed\s+(access|permission|scope)/i,
      /disable\s+(logging|audit|monitoring|rate.limit)/i,
    ],
  },

  // â”€â”€ Network Abuse â”€â”€
  {
    category: 'network_abuse',
    severity: 'warning',
    title: 'Unusual network activity patterns',
    description: 'Instructions suggesting unusual network operations like port scanning or mass requests.',
    patterns: [
      /scan\s+(port|network|host|ip\s+range)/i,
      /ddos|denial.of.service/i,
      /brute\s*force/i,
      /mass\s+(email|message|request|spam)/i,
      /(?:enumerate|crawl)\s+(all\s+)?(endpoint|api|route|url)/i,
    ],
  },

  // â”€â”€ Info-level patterns (noteworthy but not blocking) â”€â”€
  {
    category: 'data_exfiltration',
    severity: 'info',
    title: 'External API calls detected',
    description: 'The persona makes calls to external APIs. Verify these are expected for the use case.',
    patterns: [
      /call\s+(external|third.party|remote)\s+(api|service|endpoint)/i,
      /https?:\/\/(?!localhost|127\.0\.0\.1)/i,
    ],
  },
  {
    category: 'unauthorized_event',
    severity: 'info',
    title: 'Event emission configured',
    description: 'The persona emits events to the event bus. Verify event types are appropriate.',
    patterns: [
      /emit[_\s]+event/i,
      /event[_\s]+bus/i,
    ],
  },
];

// â”€â”€ Unicode Normalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Normalize text to defeat Unicode homoglyph bypasses.
 *
 * 1. NFKC normalization â€” collapses compatibility equivalences (e.g. Cyrillic
 *    look-alikes, fullwidth Latin, styled math letters) into their canonical
 *    ASCII counterparts where a mapping exists.
 * 2. Strip non-ASCII whitespace (em-space, thin space, ideographic space, etc.)
 *    and zero-width characters that could break pattern matching.
 * 3. Collapse resulting whitespace runs into single spaces.
 */
function normalizeText(text: string): string {
  // NFKC normalization handles most homoglyph cases
  let normalized = text.normalize('NFKC');
  // Strip zero-width characters and non-ASCII whitespace
  normalized = normalized.replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF\u00A0\u1680\u180E\u2000-\u200A\u205F\u3000]/g, ' ');
  // Collapse whitespace runs
  normalized = normalized.replace(/  +/g, ' ');
  return normalized;
}

// â”€â”€ Text Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ExtractedText {
  source: string;
  text: string;
}

/**
 * Extract all scannable text content from a persona draft.
 */
function extractDraftTexts(draft: N8nPersonaDraft): ExtractedText[] {
  const texts: ExtractedText[] = [];

  // System prompt
  if (draft.system_prompt) {
    texts.push({ source: 'system_prompt', text: draft.system_prompt });
  }

  // Structured prompt sections
  if (draft.structured_prompt && typeof draft.structured_prompt === 'object') {
    for (const [key, value] of Object.entries(draft.structured_prompt)) {
      if (typeof value === 'string' && value.trim()) {
        texts.push({ source: `structured_prompt.${key}`, text: value });
      }
      if (key === 'customSections' && Array.isArray(value)) {
        for (const section of value) {
          if (section && typeof section === 'object' && 'content' in section) {
            const s = section as { key?: string; content?: string };
            if (typeof s.content === 'string' && s.content.trim()) {
              texts.push({ source: `structured_prompt.custom.${s.key ?? 'unknown'}`, text: s.content });
            }
          }
        }
      }
    }
  }

  // Design context
  if (draft.design_context) {
    texts.push({ source: 'design_context', text: draft.design_context });
  }

  // Tool descriptions and implementation guides
  if (draft.tools) {
    for (const tool of draft.tools) {
      if (tool.description) {
        texts.push({ source: `tool.${tool.name}.description`, text: tool.description });
      }
      if (tool.implementation_guide) {
        texts.push({ source: `tool.${tool.name}.implementation_guide`, text: tool.implementation_guide });
      }
    }
  }

  // Trigger descriptions
  if (draft.triggers) {
    for (const trigger of draft.triggers) {
      if (trigger.description) {
        texts.push({ source: `trigger.${trigger.trigger_type}.description`, text: trigger.description });
      }
    }
  }

  return texts;
}

// â”€â”€ Context Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Extract a context snippet around a regex match.
 */
function extractMatchContext(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return '';

  const idx = match.index;
  const matchLen = match[0].length;

  // Find surrounding sentence/line boundaries
  const start = Math.max(
    0,
    text.lastIndexOf('.', idx) + 1,
    text.lastIndexOf('\n', idx) + 1,
  );
  const end = Math.min(
    text.length,
    Math.min(
      text.indexOf('.', idx + matchLen) + 1 || text.length,
      text.indexOf('\n', idx + matchLen) || text.length,
    ),
  );

  const snippet = text.slice(start, end).trim();
  return snippet.length > 140 ? snippet.slice(0, 137) + '...' : snippet;
}

// â”€â”€ Scanner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Scan a persona draft for safety threats.
 *
 * Analyzes system_prompt, structured_prompt sections, tool implementation
 * guides, trigger descriptions, and design context for patterns that indicate
 * malicious instructions, data exfiltration, shadow-prompting, credential
 * abuse, privilege escalation, or unauthorized protocol usage.
 */
export function scanPersonaDraft(draft: N8nPersonaDraft): ScanResult {
  const findings: ScanFinding[] = [];
  const texts = extractDraftTexts(draft);
  const seenPatterns = new Set<string>();
  let localCounter = 0;

  for (const { source, text: rawText } of texts) {
    // Normalize Unicode to defeat homoglyph bypasses before pattern matching
    const text = normalizeText(rawText);
    for (const threat of THREAT_PATTERNS) {
      for (const pattern of threat.patterns) {
        if (pattern.test(text)) {
          // Deduplicate: same category + source = one finding
          const dedupeKey = `${threat.category}:${threat.title}:${source}`;
          if (seenPatterns.has(dedupeKey)) continue;
          seenPatterns.add(dedupeKey);

          const context = extractMatchContext(text, pattern);
          findings.push({
            id: `scan-${++localCounter}`,
            severity: threat.severity,
            category: threat.category,
            title: threat.title,
            description: threat.description,
            context,
            source,
          });
          break; // One match per threat per source is enough
        }
      }
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder: Record<ScanSeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  return {
    passed: critical.length === 0 && warnings.length === 0,
    totalFindings: findings.length,
    critical,
    warnings,
    info,
    findings,
    scannedAt: new Date().toISOString(),
  };
}

// â”€â”€ Tool-Specific Scanner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Additional patterns specifically for tool implementation guides.
 */
const TOOL_THREAT_PATTERNS: Array<{
  severity: ScanSeverity;
  title: string;
  description: string;
  pattern: RegExp;
}> = [
  {
    severity: 'critical',
    title: 'Code execution in tool guide',
    description: 'Tool implementation guide contains executable code patterns that could be dangerous.',
    pattern: /eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]/i,
  },
  {
    severity: 'warning',
    title: 'Unrestricted HTTP method in tool',
    description: 'Tool implementation allows arbitrary HTTP methods which could be misused.',
    pattern: /method\s*[:=]\s*['"`]?(DELETE|PUT|PATCH)['"`]?\s*.*(?:any|all|arbitrary)/i,
  },
  {
    severity: 'warning',
    title: 'Hardcoded URL in tool implementation',
    description: 'Tool contains hardcoded external URLs that bypass connector configuration.',
    pattern: /https?:\/\/(?!localhost|127\.0\.0\.1|example\.com|placeholder)[a-z0-9][a-z0-9.-]+\.[a-z]{2,}/i,
  },
];

/**
 * Scan tool drafts specifically for implementation guide threats.
 * Supplements the main scanner with tool-specific checks.
 */
export function scanToolDrafts(tools: N8nToolDraft[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  let localCounter = 0;

  for (const tool of tools) {
    const rawGuide = tool.implementation_guide;
    if (!rawGuide) continue;

    // Normalize Unicode to defeat homoglyph bypasses
    const guide = normalizeText(rawGuide);

    for (const threat of TOOL_THREAT_PATTERNS) {
      if (threat.pattern.test(guide)) {
        findings.push({
          id: `tool-scan-${++localCounter}`,
          severity: threat.severity,
          category: 'dangerous_tool',
          title: threat.title,
          description: threat.description,
          context: extractMatchContext(guide, threat.pattern),
          source: `tool.${tool.name}.implementation_guide`,
        });
      }
    }
  }

  return findings;
}

// â”€â”€ Display Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const SEVERITY_CONFIG: Record<ScanSeverity, {
  label: string;
  bg: string;
  text: string;
  border: string;
  dotColor: string;
}> = {
  critical: {
    label: 'Critical',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    dotColor: 'bg-red-500',
  },
  warning: {
    label: 'Warning',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
  },
  info: {
    label: 'Info',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    dotColor: 'bg-blue-500',
  },
};

export const CATEGORY_LABELS: Record<ScanCategory, string> = {
  data_exfiltration: 'Data Exfiltration',
  shadow_prompting: 'Shadow Prompting',
  unauthorized_event: 'Unauthorized Events',
  credential_abuse: 'Credential Abuse',
  privilege_escalation: 'Privilege Escalation',
  hidden_instruction: 'Hidden Instructions',
  dangerous_tool: 'Dangerous Tool',
  network_abuse: 'Network Abuse',
};
