import { describe, expect, it } from 'vitest';
import { extractStreamPhase, phaseLabel } from '../extractStreamPhase';

// Mock `t` shape — only the keys phaseLabel reads. The proxy returns
// the key path as the value so assertions can match strings without
// loading the full i18n bundle.
const t = {
  plugins: {
    companion: {
      phase_connecting: 'Connecting…',
      phase_reviewing: 'Reviewing result…',
      phase_thinking: 'Thinking…',
      phase_websearch: 'Searching the web…',
      phase_webfetch: 'Fetching a page…',
      phase_reading: 'Reading files…',
      phase_searching_code: 'Searching the code…',
      phase_editing: 'Editing files…',
      phase_running_command: 'Running a command…',
      phase_subagent: 'Asking a subagent…',
      phase_using_tool: 'Using {tool}…',
    },
  },
} as unknown as Parameters<typeof phaseLabel>[0];

const tx = ((template: string, params: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_m, k) => params[k] ?? '')) as Parameters<
  typeof phaseLabel
>[1];

describe('extractStreamPhase', () => {
  it('returns null for the `system` session-init line so the bubble keeps its default "Thinking…" placeholder', () => {
    // Regression guard: prior shipped version returned {kind:'system'}
    // which mapped to "Connecting…" and got stuck for the entire
    // pre-text wait (model warm-up can be 5-20s with no other CLI
    // line arriving). Mapping was misleading — by the time `system`
    // arrives we're past connecting, we're thinking.
    const line = JSON.stringify({
      type: 'system',
      session_id: 'sess_abc',
      model: 'claude-opus-4-7',
    });
    expect(extractStreamPhase(line)).toBeNull();
  });

  it('returns the `reviewing` phase for user-role tool-result echoes', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [] } });
    expect(extractStreamPhase(line)).toEqual({ kind: 'reviewing' });
  });

  it('returns null for assistant text blocks so prose streams visibly', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello, ' }] },
    });
    expect(extractStreamPhase(line)).toBeNull();
  });

  it('extracts tool_use phase with the tool name', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x.ts' } }],
      },
    });
    expect(extractStreamPhase(line)).toEqual({ kind: 'tool_use', toolName: 'Read' });
  });

  it('returns the `thinking` phase for assistant thinking blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '...' }] },
    });
    expect(extractStreamPhase(line)).toEqual({ kind: 'thinking' });
  });

  it('tolerates malformed json without throwing', () => {
    expect(extractStreamPhase('not-json')).toBeNull();
    expect(extractStreamPhase('')).toBeNull();
    expect(extractStreamPhase('{}')).toBeNull();
  });
});

describe('phaseLabel', () => {
  it('maps reviewing → "Reviewing result…"', () => {
    expect(phaseLabel(t, tx, { kind: 'reviewing' })).toBe('Reviewing result…');
  });

  it('maps thinking → "Thinking…"', () => {
    expect(phaseLabel(t, tx, { kind: 'thinking' })).toBe('Thinking…');
  });

  it('maps known tool names to friendly phrases', () => {
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'WebSearch' })).toBe(
      'Searching the web…',
    );
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'Read' })).toBe('Reading files…');
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'Grep' })).toBe(
      'Searching the code…',
    );
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'Edit' })).toBe('Editing files…');
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'Bash' })).toBe(
      'Running a command…',
    );
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'Task' })).toBe(
      'Asking a subagent…',
    );
  });

  it('falls through to the "Using {tool}…" template for unknown tools', () => {
    expect(phaseLabel(t, tx, { kind: 'tool_use', toolName: 'WidgetMaker' })).toBe(
      'Using WidgetMaker…',
    );
  });
});
