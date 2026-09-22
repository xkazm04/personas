import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { readRichBlock } from '../richBlocks';

// Real English catalog as `t`, the SurfaceRenderer test's pattern.
vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const tx = (template: string, vars: Record<string, unknown> = {}) =>
    String(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  return { useTranslation: () => ({ t: en, tx, language: 'en' }), getActiveTranslations: () => en };
});
vi.mock('@/features/shared/dispatch/DispatchChooser', () => ({
  DispatchChooserModal: ({ request }: { request: { title: string } }) => (
    <div data-testid="dispatch-chooser">{request.title}</div>
  ),
}));
vi.mock('@/features/shared/components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({ title }: { title: string }) => <div data-testid="confirm-dialog">{title}</div>,
}));

const { RichMarkdown } = await import('../RichMarkdown');

const fence = (body: string) => '```json\n' + body + '\n```';

describe('readRichBlock — a tag is read into the SurfaceSpec block, through its schema', () => {
  it('reads a stats body as an array or as {stats}', () => {
    const arr = readRichBlock('stats', {}, '[{"label":"Observed","value":"144/1044"}]');
    const obj = readRichBlock('stats', {}, '{"stats":[{"label":"Met","value":66}]}');
    expect(arr.ok && arr.block.type).toBe('stat_row');
    expect(obj.ok && obj.block.type === 'stat_row' && obj.block.stats[0]!.value).toBe('66');
  });

  it('coerces a gauge value from its attribute and clamps it into 0-100', () => {
    const r = readRichBlock('gauge', { label: 'Coverage', value: '140' }, '');
    expect(r.ok && r.block.type === 'gauge' && r.block.value).toBe(100);
  });

  it('reads a terminal body as raw lines, not JSON', () => {
    const r = readRichBlock('terminal', { title: 'build' }, 'one\ntwo\n');
    expect(r.ok && r.block.type === 'terminal' && r.block.lines).toEqual(['one', 'two']);
  });

  it('says WHY a body is rejected, rather than rendering nothing', () => {
    expect(readRichBlock('table', {}, '{not json')).toMatchObject({ ok: false });
    const r = readRichBlock('table', {}, '{"columns":[],"rows":[]}');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/columns/);
  });
});

describe('RichMarkdown — one vocabulary inside prose', () => {
  it('renders plain markdown exactly as markdown', () => {
    render(<RichMarkdown content={'# Title\n\nJust **text**.'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('text').tagName).toBe('STRONG');
  });

  it('renders a card with its label as the title and its body as markdown', () => {
    render(<RichMarkdown content={':::card[Watch this]{tone=amber}\nThe body has **bold**.\n:::'} />);
    const card = screen.getByTestId('rich-card');
    expect(card).toHaveTextContent('Watch this');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders an inline pill inside a sentence', () => {
    render(<RichMarkdown content={'State is :pill[stale]{tone=blue} today.'} />);
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText(/State is/)).toBeInTheDocument();
  });

  it('renders a SurfaceSpec block from a fenced body', () => {
    render(
      <RichMarkdown
        content={`:::stats\n${fence('[{"label":"Observed","value":"144/1044"},{"label":"Met","value":66}]')}\n:::`}
      />,
    );
    expect(screen.getByTestId('rich-stats')).toHaveTextContent('144/1044');
    expect(screen.getByTestId('rich-stats')).toHaveTextContent('Observed');
  });

  it('keeps prose that merely LOOKS like a tag - "status:ok" is not swallowed', () => {
    render(<RichMarkdown content={'The build said status:ok and moved on.'} />);
    expect(screen.getByText('The build said status:ok and moved on.')).toBeInTheDocument();
  });

  it('shows an unknown block as written, with the reason, instead of dropping it', () => {
    render(<RichMarkdown content={':::chart{kind=line}\nsome body\n:::'} />);
    const kept = screen.getByTestId('rich-unreadable');
    expect(kept).toHaveTextContent('"chart" is not a known tag');
    expect(kept).toHaveTextContent(':::chart{kind=line}');
  });

  it('shows a block whose body fails the schema, with the schema reason', () => {
    render(<RichMarkdown content={`:::table\n${fence('{"columns":[],"rows":[]}')}\n:::`} />);
    expect(screen.getByTestId('rich-unreadable')).toHaveTextContent(/could not be shown/);
  });

  it('never runs an action on its own - a block action only opens consent', () => {
    const run = vi.fn().mockResolvedValue('x');
    const body = fence(
      JSON.stringify([
        {
          id: 'd1',
          title: 'Re-measure coverage',
          actions: [{ id: 'go', label: 'Run it', kind: 'execute_persona', prompt: 'measure' }],
        },
      ]),
    );
    render(<RichMarkdown content={`:::decisions\n${body}\n:::`} context={{ personaId: 'p1', onExecutePersona: run }} />);
    fireEvent.click(screen.getByRole('button', { name: /Run it/ }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
  });
});
