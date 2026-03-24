import type { TriggerFormState } from './configs/buildTriggerConfig';

export interface NlParseResult {
  triggerType: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  formOverrides: Partial<TriggerFormState>;
}

interface ParseRule {
  patterns: RegExp[];
  triggerType: string;
  extract: (input: string, match: RegExpMatchArray) => Partial<TriggerFormState>;
  label: (input: string, match: RegExpMatchArray) => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a time interval in seconds from natural language. */
function parseInterval(input: string): number | null {
  const m = input.match(/(?:every|each)\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?/i);
  if (!m || !m[1] || !m[2]) return null;
  const n = parseInt(m[1]);
  switch (m[2].toLowerCase().replace(/s$/, '')) {
    case 'second': case 'sec': return Math.max(60, n);
    case 'minute': case 'min': return n * 60;
    case 'hour': case 'hr': return n * 3600;
    case 'day': return n * 86400;
    default: return null;
  }
}

/** Try to extract a cron expression from common time-of-day phrases. */
function parseCron(input: string): string | null {
  const lower = input.toLowerCase();

  // "every hour" / "hourly"
  if (/\b(every\s+hour|hourly)\b/.test(lower)) return '0 * * * *';
  // "every day" / "daily"
  if (/\b(every\s+day|daily)\b/.test(lower) && !/\bat\s+\d/.test(lower)) return '0 9 * * *';
  // "every week" / "weekly"
  if (/\b(every\s+week|weekly)\b/.test(lower)) return '0 9 * * 1';
  // "every month" / "monthly"
  if (/\b(every\s+month|monthly)\b/.test(lower)) return '0 9 1 * *';

  // "at 9am" / "at 14:30" / "at 2pm"
  const atTime = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (atTime && atTime[1]) {
    let hour = parseInt(atTime[1]);
    const minute = atTime[2] ? parseInt(atTime[2]) : 0;
    const ampm = atTime[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    // Check for day-of-week
    const dow = parseDayOfWeek(lower);
    if (dow !== null) return `${minute} ${hour} * * ${dow}`;
    return `${minute} ${hour} * * *`;
  }

  return null;
}

function parseDayOfWeek(input: string): string | null {
  const days: Record<string, string> = {
    monday: '1', tuesday: '2', wednesday: '3', thursday: '4',
    friday: '5', saturday: '6', sunday: '0',
    mon: '1', tue: '2', wed: '3', thu: '4', fri: '5', sat: '6', sun: '0',
  };
  for (const [name, num] of Object.entries(days)) {
    if (new RegExp(`\\b${name}s?\\b`, 'i').test(input)) return num;
  }
  if (/\bweekday/i.test(input)) return '1-5';
  if (/\bweekend/i.test(input)) return '0,6';
  return null;
}

/** Extract file extensions from natural language (e.g. ".py files", "python files"). */
function extractGlobFilter(input: string): string {
  const extMap: Record<string, string> = {
    python: '*.py', py: '*.py', javascript: '*.js', js: '*.js',
    typescript: '*.ts', ts: '*.ts', tsx: '*.tsx', jsx: '*.jsx',
    rust: '*.rs', rs: '*.rs', go: '*.go', java: '*.java',
    css: '*.css', html: '*.html', json: '*.json', yaml: '*.yaml',
    yml: '*.yml', toml: '*.toml', markdown: '*.md', md: '*.md',
    csv: '*.csv', log: '*.log', txt: '*.txt', xml: '*.xml',
    sql: '*.sql', rb: '*.rb', ruby: '*.rb', php: '*.php',
    swift: '*.swift', kotlin: '*.kt', kt: '*.kt', c: '*.c',
    cpp: '*.cpp', h: '*.h', hpp: '*.hpp',
  };

  // Match ".py" or "*.py" or "py files" or "python files"
  const dotExt = input.match(/\.\s*([\w]+)\s+files?\b/i);
  if (dotExt) return `*.${dotExt[1]}`;

  const starExt = input.match(/\*\.([\w]+)/);
  if (starExt) return `*.${starExt[1]}`;

  const lower = input.toLowerCase();
  for (const [keyword, glob] of Object.entries(extMap)) {
    if (new RegExp(`\\b${keyword}\\s+files?\\b`, 'i').test(lower)) return glob;
    if (new RegExp(`\\b\\.${keyword}\\b`).test(lower)) return `*.${keyword}`;
  }
  return '';
}

/** Extract a directory path from the input. */
function extractPath(input: string): string {
  // Match quoted paths
  const quoted = input.match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1];
  // Match Unix-style paths
  const unix = input.match(/(?:in|from|at|under)\s+(\/[\w./-]+)/i);
  if (unix?.[1]) return unix[1];
  // Match Windows-style paths
  const win = input.match(/(?:in|from|at|under)\s+([A-Z]:\\[\w.\\\s-]+)/i);
  if (win?.[1]) return win[1].trimEnd();
  return '';
}

/** Extract app names from the input. */
function extractAppNames(input: string): string[] {
  const appMap: Record<string, string> = {
    'vs code': 'Code.exe', vscode: 'Code.exe', code: 'Code.exe',
    chrome: 'chrome.exe', firefox: 'firefox.exe', edge: 'msedge.exe',
    slack: 'slack.exe', discord: 'discord.exe', teams: 'Teams.exe',
    terminal: 'WindowsTerminal.exe', 'windows terminal': 'WindowsTerminal.exe',
    notepad: 'notepad.exe', word: 'WINWORD.EXE', excel: 'EXCEL.EXE',
    outlook: 'OUTLOOK.EXE', figma: 'Figma.exe', notion: 'Notion.exe',
    obsidian: 'Obsidian.exe', cursor: 'Cursor.exe',
  };
  const lower = input.toLowerCase();
  const found: string[] = [];
  for (const [keyword, exe] of Object.entries(appMap)) {
    if (lower.includes(keyword) && !found.includes(exe)) found.push(exe);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Parse rules (ordered by specificity, first match wins)
// ---------------------------------------------------------------------------

const RULES: ParseRule[] = [
  // --- File Watcher ---
  {
    patterns: [
      /\b(save|change|modify|create|edit|update|delete|rename|add)\b.*\b(file|folder|directory)\b/i,
      /\b(file|folder|directory)\b.*\b(save|change|modif|creat|edit|updat|delet|renam|add)\b/i,
      /\bwatch\b.*\b(file|folder|path|directory)\b/i,
      /\bnew\s+\.\w+\s+file/i,
      /\bwhen\b.*\b\.\w+\b.*\b(appears?|changes?|saved?|modified?|created?|added?)\b/i,
    ],
    triggerType: 'file_watcher',
    extract: (input) => {
      const events: string[] = [];
      const lower = input.toLowerCase();
      if (/\b(save|modify|change|edit|update)\b/i.test(lower)) events.push('modify');
      if (/\b(create|new|add|appear)\b/i.test(lower)) events.push('create');
      if (/\b(delete|remove)\b/i.test(lower)) events.push('delete');
      if (/\b(rename|move)\b/i.test(lower)) events.push('rename');
      if (events.length === 0) events.push('modify');

      const path = extractPath(input);
      const glob = extractGlobFilter(input);
      const recursive = !/\bnon-?recursive\b/i.test(lower);

      return {
        triggerType: 'file_watcher',
        watchPaths: path ? [path] : [''],
        watchEvents: events,
        watchRecursive: recursive,
        globFilter: glob,
      };
    },
    label: (_input) => {
      const glob = extractGlobFilter(_input);
      return glob ? `Watch ${glob} file changes` : 'Watch file changes';
    },
  },

  // --- Clipboard ---
  {
    patterns: [
      /\b(clipboard|copy|copied|paste)\b/i,
    ],
    triggerType: 'clipboard',
    extract: (input) => {
      const lower = input.toLowerCase();
      let contentType = 'text';
      if (/\bimage\b/.test(lower)) contentType = 'image';
      else if (/\bany\b/.test(lower)) contentType = 'any';

      let pattern = '';
      if (/\burl\b|https?\b|links?\b/.test(lower)) pattern = 'https?://\\S+';
      else if (/\berror\b|exception\b/.test(lower)) pattern = '(?i)(error|exception|traceback|panic)';
      else if (/\bcode\b|snippet\b/.test(lower)) pattern = '(function |def |class |import |const |=>)';

      // Check for custom pattern in quotes
      const quoted = input.match(/(?:matching|pattern|regex|contains?)\s+["']([^"']+)["']/i);
      if (quoted?.[1]) pattern = quoted[1];

      return {
        triggerType: 'clipboard',
        clipboardContentType: contentType,
        clipboardPattern: pattern,
        clipboardInterval: '3',
      };
    },
    label: (input) => {
      if (/\burl\b|https?\b|link\b/i.test(input)) return 'Clipboard: URL copied';
      if (/\berror\b|exception\b/i.test(input)) return 'Clipboard: error copied';
      return 'Clipboard content change';
    },
  },

  // --- App Focus ---
  {
    patterns: [
      /\b(focus|switch\s+to|open|activate|foreground)\b.*\b(app|application|window|program)\b/i,
      /\bwhen\s+(?:I\s+)?(?:focus|switch|open)\b.*\b(vs\s*code|chrome|firefox|slack|discord|terminal|notepad|excel|word|outlook|figma|notion|obsidian|cursor|edge|teams)\b/i,
      /\b(vs\s*code|chrome|firefox|slack|discord|terminal|notepad|excel|word|outlook|figma|notion|obsidian|cursor|edge|teams)\b.*\b(focus|active|foreground|opened)\b/i,
    ],
    triggerType: 'app_focus',
    extract: (input) => {
      const apps = extractAppNames(input);
      let titlePattern = '';
      const titleMatch = input.match(/(?:title|window)\s+(?:matching|contains?|with)\s+["']([^"']+)["']/i);
      if (titleMatch?.[1]) titlePattern = titleMatch[1];

      return {
        triggerType: 'app_focus',
        appNames: apps.length > 0 ? apps : [''],
        titlePattern,
        appFocusInterval: '3',
      };
    },
    label: (input) => {
      const apps = extractAppNames(input);
      if (apps.length > 0) return `App focus: ${apps.join(', ')}`;
      return 'App focus change';
    },
  },

  // --- Webhook ---
  {
    patterns: [
      /\bwebhook\b/i,
      /\bhttp\s+(request|call|post|endpoint)\b/i,
      /\breceive\s+(?:a\s+)?(?:http|web|api)\b/i,
    ],
    triggerType: 'webhook',
    extract: () => ({
      triggerType: 'webhook',
      hmacSecret: '',
    }),
    label: () => 'Webhook listener',
  },

  // --- Event Listener ---
  {
    patterns: [
      /\bevent\s+listener\b/i,
      /\blisten\s+(?:for|to)\s+(?:event|signal)\b/i,
      /\bwhen\s+event\b/i,
      /\breact\s+to\s+(?:event|signal)\b/i,
    ],
    triggerType: 'event_listener',
    extract: (input) => {
      const eventMatch = input.match(/(?:listen|event|for|to)\s+["']([^"']+)["']/i);
      const sourceMatch = input.match(/(?:from|source)\s+["']([^"']+)["']/i);
      return {
        triggerType: 'event_listener',
        listenEventType: eventMatch?.[1] ?? '',
        sourceFilter: sourceMatch?.[1] ?? '',
      };
    },
    label: (input) => {
      const eventMatch = input.match(/(?:listen|event|for|to)\s+["']([^"']+)["']/i);
      return eventMatch ? `Listen for "${eventMatch[1]}"` : 'Event listener';
    },
  },

  // --- Schedule (cron-based or interval-based) ---
  {
    patterns: [
      /\bevery\s+\d+\s*(second|sec|minute|min|hour|hr|day)s?\b/i,
      /\b(hourly|daily|weekly|monthly)\b/i,
      /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
      /\bcron\b/i,
      /\bschedule\b/i,
      /\brun\s+(this|it|the\s+persona)\b.*\bevery\b/i,
      /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend)\b/i,
    ],
    triggerType: 'schedule',
    extract: (input) => {
      const cron = parseCron(input);
      if (cron) {
        return {
          triggerType: 'schedule',
          scheduleMode: 'cron' as const,
          cronExpression: cron,
        };
      }
      const interval = parseInterval(input);
      if (interval) {
        return {
          triggerType: 'schedule',
          scheduleMode: 'interval' as const,
          interval: String(interval),
        };
      }
      return { triggerType: 'schedule', scheduleMode: 'interval' as const, interval: '3600' };
    },
    label: (input) => {
      const cron = parseCron(input);
      if (cron) return `Schedule: ${cron}`;
      const interval = parseInterval(input);
      if (interval) {
        if (interval >= 86400) return `Every ${interval / 86400} day(s)`;
        if (interval >= 3600) return `Every ${interval / 3600} hour(s)`;
        return `Every ${interval / 60} minute(s)`;
      }
      return 'Scheduled trigger';
    },
  },

  // --- Polling ---
  {
    patterns: [
      /\bpoll\b/i,
      /\bcheck\s+(?:an?\s+)?(?:endpoint|url|api|site|page)\b/i,
    ],
    triggerType: 'polling',
    extract: (input) => {
      const urlMatch = input.match(/(?:https?:\/\/\S+)/i);
      const interval = parseInterval(input) ?? 300;
      return {
        triggerType: 'polling',
        endpoint: urlMatch?.[0] ?? '',
        interval: String(interval),
      };
    },
    label: () => 'Polling endpoint',
  },
];

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseNaturalLanguageTrigger(input: string): NlParseResult | null {
  const trimmed = input.trim();
  if (trimmed.length < 3) return null;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const formOverrides = rule.extract(trimmed, match);
        const label = rule.label(trimmed, match);

        // Confidence heuristic: longer inputs that match specific patterns = higher confidence
        let confidence: 'high' | 'medium' | 'low' = 'medium';
        if (trimmed.length > 20 && rule.patterns.length > 1) confidence = 'high';
        if (trimmed.length < 10) confidence = 'low';

        return {
          triggerType: rule.triggerType,
          label,
          confidence,
          formOverrides,
        };
      }
    }
  }

  return null;
}
