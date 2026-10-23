import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const copyText = vi.fn();
vi.mock('@/hooks/utility/interaction/useCopyToClipboard', () => ({
  copyText: (...a: unknown[]) => copyText(...a),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { selectedPersona: { name: string } }) => unknown) => sel({ selectedPersona: { name: 'Scout' } }),
}));
vi.mock('../../../libs/reportGenerator', () => ({
  generateHtmlReport: () => '<html></html>',
  generateMarkdownReport: () => '# report',
  downloadHtmlReport: vi.fn(),
}));

import { ExportReportButton } from '../ExportReportButton';
import type { LabRunAny, LabResultAny } from '../../../libs/reportGenerator';

// Fixtures: the generator is mocked, so the run/result shapes are never read.
const run = {} as LabRunAny;
const results = [{} as LabResultAny];

describe('ExportReportButton - "Copied" only when the clipboard took it', () => {
  beforeEach(() => copyText.mockReset());

  it('regression: a refused clipboard write does not report success', async () => {
    copyText.mockResolvedValue(false);
    render(<ExportReportButton mode="arena" run={run} results={results} />);
    fireEvent.click(screen.getByTestId('export-report-md'));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('# report'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // The copied state swaps the clipboard icon for a success check.
    expect(screen.getByTestId('export-report-md').querySelector('.text-status-success')).toBeNull();
  });

  it('a successful write reports success', async () => {
    copyText.mockResolvedValue(true);
    render(<ExportReportButton mode="arena" run={run} results={results} />);
    fireEvent.click(screen.getByTestId('export-report-md'));
    await waitFor(() => expect(screen.getByTestId('export-report-md').querySelector('.text-status-success')).not.toBeNull());
  });
});
