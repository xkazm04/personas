/** Task output header, streaming badge and view-toggle tooltip read from the catalog. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const toMarkers = (node: unknown, path: string): unknown =>
    node && typeof node === 'object'
      ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toMarkers(v, path ? `${path}.${k}` : k)]))
      : path;
  const t = toMarkers(en, '');
  return { useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }) };
});
vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({ MarkdownRenderer: () => null }));
vi.mock('@/features/shared/components/editors/RichMarkdown', () => ({ RichMarkdown: () => null }));

import { TaskOutputPanel } from '../TaskOutputPanel';

describe('TaskOutputPanel copy', () => {
  it('reads line count, streaming badge and toggle title from the catalog', () => {
    render(<TaskOutputPanel taskId="t" lines={['a', 'b']} isRunning />);
    expect(screen.getByText('plugins.dev_runner.output_lines_other')).toBeInTheDocument();
    expect(screen.getByText('plugins.dev_runner.output_streaming')).toBeInTheDocument();
    expect(screen.getByRole('button').getAttribute('title')).toBe('plugins.dev_runner.output_show_rendered');
  });
});
