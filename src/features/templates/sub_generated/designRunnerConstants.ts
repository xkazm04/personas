export interface PredefinedTestCase {
  id: string;
  name: string;
  instruction: string;
  tools?: string;
  trigger?: string;
  category?: string;
}

export interface ParsedTemplate {
  id: string;
  name: string;
  instruction: string;
  tools: string;
  trigger: string;
  category: string;
}

export function parseListMdFormat(text: string): ParsedTemplate[] {
  const templates: ParsedTemplate[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Match: **N. Template Name**
    const headerMatch = line.match(/^\*\*(\d+)\.\s+(.+?)\*\*$/);
    if (!headerMatch) continue;

    const num = headerMatch[1]!;
    const name = headerMatch[2]!;

    // Next line is the description
    let description = '';
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1]!.trim();
      // Skip if it's another header or metadata line or section divider
      if (nextLine && !nextLine.startsWith('**') && !nextLine.startsWith('`Tools:') && nextLine !== '---') {
        description = nextLine;
        i++;
      }
    }

    // Look for metadata line: `Tools: ...` · `Trigger: ...` · `Category: ...`
    let tools = '';
    let trigger = '';
    let category = '';
    if (i + 1 < lines.length) {
      const metaLine = lines[i + 1]!.trim();
      const toolsMatch = metaLine.match(/`Tools:\s*([^`]+)`/);
      const triggerMatch = metaLine.match(/`Trigger:\s*([^`]+)`/);
      const categoryMatch = metaLine.match(/`Category:\s*([^`]+)`/);
      if (toolsMatch) tools = toolsMatch[1]!.trim();
      if (triggerMatch) trigger = triggerMatch[1]!.trim();
      if (categoryMatch) category = categoryMatch[1]!.trim();
      if (toolsMatch || triggerMatch || categoryMatch) i++;
    }

    templates.push({
      id: `template_${num}`,
      name,
      instruction: description,
      tools,
      trigger,
      category,
    });
  }

  return templates;
}

export const PREDEFINED_TEST_CASES: PredefinedTestCase[] = [
  {
    id: 'gmail-filter',
    name: 'Gmail Smart Filter',
    instruction: 'Create an agent that monitors Gmail for important emails, categorizes them by sender and urgency, applies labels, and forwards urgent ones to Slack. Use polling trigger with gmail and slack connectors.',
  },
  {
    id: 'github-reviewer',
    name: 'GitHub PR Reviewer',
    instruction: 'Create an agent that automatically reviews pull requests for code quality, security issues, and best practices. Triggers on webhook when a PR is opened or updated. Uses github connector.',
  },
  {
    id: 'calendar-digest',
    name: 'Daily Calendar Digest',
    instruction: 'Create an agent that compiles a daily digest of upcoming meetings, prep notes, and schedule conflicts. Runs on a morning schedule trigger. Uses google_calendar connector and sends summary via email.',
  },
  {
    id: 'webhook-processor',
    name: 'Webhook Data Processor',
    instruction: 'Create an agent that receives webhook payloads, validates the data, transforms it, and routes it to the appropriate downstream system via HTTP requests. Uses webhook trigger and http connector.',
  },
  {
    id: 'multi-agent-coord',
    name: 'Multi-Agent Coordinator',
    instruction: 'Create an agent that orchestrates other personas by subscribing to their execution events, aggregating results, handling failures, and triggering follow-up actions. Uses event subscriptions for execution_completed and execution_failed events.',
  },
];

export const CATEGORY_COLORS: Record<string, string> = {
  Email: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  Development: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  Content: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  Research: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  'Project Management': 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  Finance: 'bg-green-500/15 text-green-300 border-green-500/25',
  DevOps: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  HR: 'bg-pink-500/15 text-pink-300 border-pink-500/25',
  Sales: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
  Support: 'bg-teal-500/15 text-teal-300 border-teal-500/25',
  Legal: 'bg-red-500/15 text-red-300 border-red-500/25',
  Productivity: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  Marketing: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25',
  Security: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  Pipeline: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
};
