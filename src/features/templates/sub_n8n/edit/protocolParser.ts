/**
 * Extracts protocol capabilities (manual reviews, user messages, agent memory,
 * events) from a persona's system_prompt and structured_prompt text.
 *
 * These capabilities are embedded as protocol message instructions in the prompt,
 * not as separate DB entities. This parser surfaces them for display in the
 * Edit and Confirm steps of the n8n wizard.
 */

export type ProtocolType = 'manual_review' | 'user_message' | 'agent_memory' | 'emit_event';

export interface ProtocolCapability {
  type: ProtocolType;
  label: string;
  context: string;
}

interface ProtocolPattern {
  type: ProtocolType;
  label: string;
  /** Keywords to match (case-insensitive) in prompt text */
  keywords: string[];
  /** Keywords in structured_prompt customSection keys */
  sectionKeys: string[];
}

const PROTOCOL_PATTERNS: ProtocolPattern[] = [
  {
    type: 'manual_review',
    label: 'Manual Review',
    keywords: ['manual_review', 'manual review', 'human-in-the-loop', 'human in the loop', 'approval gate', 'wait for approval'],
    sectionKeys: ['human_in_the_loop', 'manual_review', 'approval'],
  },
  {
    type: 'user_message',
    label: 'User Notifications',
    keywords: ['user_message', 'user message', 'notify the user', 'send a message', 'status update', 'completion report'],
    sectionKeys: ['notification', 'alerts', 'messaging'],
  },
  {
    type: 'agent_memory',
    label: 'Agent Memory',
    keywords: ['agent_memory', 'agent memory', 'remember across runs', 'persist knowledge', 'store as memory', 'memory strategy'],
    sectionKeys: ['memory_strategy', 'memory', 'learning'],
  },
  {
    type: 'emit_event',
    label: 'Event Emission',
    keywords: ['emit_event', 'emit event', 'trigger other persona', 'inter-persona'],
    sectionKeys: ['events', 'emit_event'],
  },
];

interface CustomSection {
  key: string;
  label?: string;
  content?: string;
}

/**
 * Extract protocol capabilities from system_prompt and structured_prompt.
 *
 * Scans for keyword patterns in the prompt text and custom sections to identify
 * which protocol message types the persona uses.
 */
export function extractProtocolCapabilities(
  systemPrompt: string | null | undefined,
  structuredPrompt: Record<string, unknown> | null | undefined,
): ProtocolCapability[] {
  const capabilities: ProtocolCapability[] = [];
  const fullText = (systemPrompt ?? '').toLowerCase();

  // Collect structured prompt text for scanning
  let structuredText = '';
  const customSections: CustomSection[] = [];

  if (structuredPrompt && typeof structuredPrompt === 'object') {
    for (const [key, value] of Object.entries(structuredPrompt)) {
      if (typeof value === 'string') {
        structuredText += ` ${value.toLowerCase()}`;
      }
      if (key === 'customSections' && Array.isArray(value)) {
        for (const section of value) {
          if (section && typeof section === 'object' && 'key' in section) {
            customSections.push(section as CustomSection);
            if (typeof (section as CustomSection).content === 'string') {
              structuredText += ` ${((section as CustomSection).content ?? '').toLowerCase()}`;
            }
          }
        }
      }
    }
  }

  const combinedText = `${fullText} ${structuredText}`;

  for (const pattern of PROTOCOL_PATTERNS) {
    // Check keywords in combined prompt text
    const matchedKeyword = pattern.keywords.find((kw) => combinedText.includes(kw));

    // Check custom section keys
    const matchedSection = customSections.find((s) =>
      pattern.sectionKeys.some((sk) => s.key.toLowerCase().includes(sk)),
    );

    if (matchedKeyword || matchedSection) {
      // Build context from the matched section or a generic description
      let context = '';
      if (matchedSection) {
        context = matchedSection.label
          ?? matchedSection.key.replace(/_/g, ' ');
      } else if (matchedKeyword) {
        context = extractSurroundingContext(combinedText, matchedKeyword);
      }

      capabilities.push({
        type: pattern.type,
        label: pattern.label,
        context,
      });
    }
  }

  return capabilities;
}

/**
 * Extract a short context snippet around a keyword match.
 */
function extractSurroundingContext(text: string, keyword: string): string {
  const idx = text.indexOf(keyword);
  if (idx === -1) return '';

  // Find the sentence or line containing the keyword
  const start = Math.max(0, text.lastIndexOf('.', idx) + 1, text.lastIndexOf('\n', idx) + 1);
  const end = Math.min(
    text.length,
    Math.min(
      text.indexOf('.', idx + keyword.length) + 1 || text.length,
      text.indexOf('\n', idx + keyword.length) || text.length,
    ),
  );

  const snippet = text.slice(start, end).trim();
  if (snippet.length > 120) {
    return snippet.slice(0, 117) + '...';
  }
  return snippet;
}

/**
 * Count capabilities by type for entity grid display.
 */
export function countByType(capabilities: ProtocolCapability[]): Record<ProtocolType, number> {
  const counts: Record<ProtocolType, number> = {
    manual_review: 0,
    user_message: 0,
    agent_memory: 0,
    emit_event: 0,
  };
  for (const cap of capabilities) {
    counts[cap.type]++;
  }
  return counts;
}
