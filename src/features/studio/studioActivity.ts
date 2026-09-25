// What Athena is DOING during a build turn, in plain words.
//
// The CLI's stream-json already carries every tool call (a whole `assistant`
// message with `tool_use` blocks), but Studio only ever read the prose deltas,
// so a ten-minute turn showed nothing but text. This turns each tool call into a
// kind the UI can say in plain language ("Checking the code for mistakes") plus
// the raw detail, which only the activity log shows.

export type StudioActivityKind =
  | 'research'
  | 'search'
  | 'read'
  | 'build'
  | 'check'
  | 'browser'
  | 'command'
  | 'other';

export interface StudioActivity {
  id: string;
  kind: StudioActivityKind;
  /** A short human subject for the kind, e.g. "Hero" for a Write of components/Hero.tsx. */
  subject: string | null;
  /** The raw tool call, for the activity log only. */
  detail: string;
  ts: number;
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/** Tool calls in one stream-json line (a whole `assistant` message), or []. */
export function extractToolUses(line: string): ToolUse[] {
  try {
    const json = JSON.parse(line);
    if (json?.type !== 'assistant') return [];
    const blocks = json?.message?.content;
    if (!Array.isArray(blocks)) return [];
    const out: ToolUse[] = [];
    for (const b of blocks) {
      if (b?.type === 'tool_use' && typeof b.name === 'string') {
        out.push({ name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} });
      }
    }
    return out;
  } catch {
    return [];
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** "components/SiteNav.tsx" -> "Site nav"; "app/order/page.tsx" -> "order page". */
export function humanizePath(path: string): string | null {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean) return null;
  const parts = clean.split('/');
  const file = parts[parts.length - 1] ?? '';
  const base = file.replace(/\.[a-z0-9]+$/i, '');
  const stem = /^(page|layout|index|route)$/i.test(base) && parts.length > 1 ? `${parts[parts.length - 2]} ${base}` : base;
  const words = stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function classifyToolUse(tool: ToolUse): Omit<StudioActivity, 'id' | 'ts'> {
  const { name, input } = tool;
  const path = str(input.file_path) || str(input.path) || str(input.notebook_path);
  if (name === 'Task' || name === 'Agent') {
    const d = str(input.description) || str(input.prompt).slice(0, 80);
    return { kind: 'research', subject: d || null, detail: `${name} ${d}`.trim() };
  }
  if (name === 'WebSearch' || name === 'WebFetch') {
    const q = str(input.query) || str(input.url);
    return { kind: 'search', subject: q || null, detail: `${name} ${q}`.trim() };
  }
  if (name === 'Read' || name === 'Grep' || name === 'Glob' || name === 'LS') {
    const target = path || str(input.pattern);
    return { kind: 'read', subject: path ? humanizePath(path) : null, detail: `${name} ${target}`.trim() };
  }
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
    return { kind: 'build', subject: path ? humanizePath(path) : null, detail: `${name} ${path}`.trim() };
  }
  if (name === 'Bash' || name === 'PowerShell') {
    const cmd = str(input.command);
    const kind: StudioActivityKind = /\btsc\b|\blint\b|\btest\b|eslint|vitest/.test(cmd) ? 'check' : 'command';
    return { kind, subject: null, detail: cmd.slice(0, 200) };
  }
  if (name.startsWith('mcp__playwright') || name.startsWith('mcp__browser')) {
    return { kind: 'browser', subject: null, detail: name };
  }
  return { kind: 'other', subject: null, detail: name };
}

/** Median of measured turn lengths in seconds, or null when none are known. */
export function typicalTurnSeconds(durations: number[]): number | null {
  if (durations.length === 0) return null;
  const s = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
