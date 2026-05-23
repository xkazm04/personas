/**
 * extractStreamPhase — parse a stream-json line from the Claude CLI and
 * return a user-friendly *phase* (what Athena is currently doing). Used
 * by the streaming bubble to replace the dead "thinking…" placeholder
 * with a live progress hint like "Reading files…" or "Searching the web…".
 *
 * Returns `null` when the line carries no phase signal (or when text
 * blocks are arriving — once text is streaming, the visible bubble
 * content IS the progress signal, no phase override needed).
 *
 * Discipline: keep this list tight. We surface tool names users will
 * recognize (Web search, Read, Edit, Bash, subagent dispatch). Everything
 * else falls through to the generic "Using X…" path. We never expose
 * internal Claude-CLI implementation details (block ids, parent_tool_use_id,
 * subagent_type, etc.) — the phase is meant to convey "she's busy, here's
 * the shape of busy", not full telemetry.
 */

import type { useTranslation } from '@/i18n/useTranslation';

type T = ReturnType<typeof useTranslation>['t'];
type Tx = ReturnType<typeof useTranslation>['tx'];

export interface StreamPhase {
  kind: 'thinking' | 'tool_use' | 'reviewing' | 'responding';
  /** Tool name when kind === 'tool_use'. e.g. 'Read', 'WebSearch', 'Task'. */
  toolName?: string;
  /**
   * Short, human-readable detail pulled from the tool's input — the search
   * query, the file being read, the command being run. Lets the status line
   * say "Searching the web · climate data" instead of just "Searching the
   * web…". Sanitized + truncated; never raw telemetry.
   */
  detail?: string;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function clip(s: string, n = 48): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

/**
 * Pull a short, recognizable detail from a tool's input. Hand-curated per
 * tool so we surface the *meaningful* field (query / file / pattern /
 * command) and nothing else. Returns undefined when there's nothing worth
 * showing — the phase then renders its bare label.
 */
function toolDetail(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  switch (name) {
    case 'WebSearch': {
      const q = str(i.query);
      return q ? clip(q) : undefined;
    }
    case 'WebFetch': {
      const u = str(i.url);
      if (!u) return undefined;
      try {
        return new URL(u).hostname;
      } catch {
        return clip(u);
      }
    }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const fp = str(i.file_path) ?? str(i.notebook_path);
      return fp ? clip(basename(fp)) : undefined;
    }
    case 'Grep':
    case 'Glob': {
      const p = str(i.pattern);
      return p ? clip(p) : undefined;
    }
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(i.command);
      return cmd ? clip(cmd, 40) : undefined;
    }
    case 'Task': {
      const d = str(i.description);
      return d ? clip(d) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Translate a phase into a user-friendly progress label. Returns null
 * for phases that should fall through to the bubble's default
 * "thinking…" placeholder.
 *
 * Tool-name mapping is hand-curated: only tools users actually
 * recognize get a humanized phrase. Unknown tools land in the
 * `phase_using_tool` template with the literal tool name interpolated —
 * better than no signal, less polished than the named cases.
 */
export function phaseLabel(t: T, tx: Tx, phase: StreamPhase): string {
  const c = t.plugins.companion;
  if (phase.kind === 'reviewing') return c.phase_reviewing;
  if (phase.kind === 'thinking') return c.phase_thinking;
  if (phase.kind === 'responding') return c.phase_responding;
  // tool_use
  const tool = phase.toolName ?? '';
  const base = ((): string => {
    switch (tool) {
      case 'WebSearch':
        return c.phase_websearch;
      case 'WebFetch':
        return c.phase_webfetch;
      case 'Read':
        return c.phase_reading;
      case 'Grep':
      case 'Glob':
        return c.phase_searching_code;
      case 'Edit':
      case 'Write':
      case 'MultiEdit':
      case 'NotebookEdit':
        return c.phase_editing;
      case 'Bash':
      case 'PowerShell':
        return c.phase_running_command;
      case 'Task':
        return c.phase_subagent;
      default:
        return tx(c.phase_using_tool, { tool });
    }
  })();
  // Append the tool's input detail when we have one ("Reading · runner.rs").
  return phase.detail ? `${base} · ${phase.detail}` : base;
}

export function extractStreamPhase(line: string): StreamPhase | null {
  try {
    const json = JSON.parse(line);
    const t = json?.type;
    // `type === 'system'` is the session-init announcement — it
    // arrives near-instant, but the next CLI line (the model's actual
    // response) can be 5-20s later as the model warms up. Surfacing
    // "Connecting…" during that wait was misleading: we're past
    // connecting, we're thinking. Return null so the bubble falls
    // through to its default "Thinking…" placeholder, which is
    // accurate during the pre-text wait. The empirical effect
    // (2026-05-19): users no longer get "stuck on Connecting…".
    if (t === 'system') return null;
    // User-role lines on the CLI's perspective are tool_result echoes
    // (the result of a tool call coming back to Claude). Briefly show
    // "Reviewing result…" before the next assistant chunk lands.
    if (t === 'user') return { kind: 'reviewing' };
    if (t === 'assistant') {
      const blocks = json?.message?.content;
      if (!Array.isArray(blocks)) return null;
      // Walk blocks; tool_use trumps thinking trumps nothing. Text
      // blocks return null so the bubble shows the streaming text
      // itself, not an obsolete phase.
      let phase: StreamPhase | null = null;
      for (const b of blocks) {
        if (b?.type === 'tool_use' && typeof b.name === 'string') {
          return { kind: 'tool_use', toolName: b.name, detail: toolDetail(b.name, b.input) };
        }
        if (b?.type === 'thinking') {
          phase = { kind: 'thinking' };
        }
        if (b?.type === 'text') {
          // Real prose is arriving — clear any prior phase so the
          // visible text becomes the progress signal.
          return null;
        }
      }
      return phase;
    }
    return null;
  } catch {
    return null;
  }
}
