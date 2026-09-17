import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisModeView } from '../AnalysisModeView';

const phase = { step: 2, total: 7, label: 'Evaluating agent identity' };

describe('AnalysisModeView', () => {
  it('offers Cancel while the analysis is running', () => {
    const onCancel = vi.fn();
    render(
      <AnalysisModeView lines={['[system] starting']} isRunning analysisPhase={phase} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByLabelText('Cancel analysis'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the failure message with Retry when the analysis failed', () => {
    const onRetry = vi.fn();
    render(
      <AnalysisModeView
        lines={['boom']}
        isRunning={false}
        analysisPhase={null}
        errorMessage="CLI exited with code 1"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Analysis failed')).toBeTruthy();
    expect(screen.getByText('CLI exited with code 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The failure forces the terminal open - that is where the reason is.
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('shows neither control on an idle successful run', () => {
    render(<AnalysisModeView lines={['done']} isRunning={false} analysisPhase={null} />);
    expect(screen.queryByText('Analysis failed')).toBeNull();
    expect(screen.queryByLabelText('Cancel analysis')).toBeNull();
  });

  it('does not offer Cancel when the host passes no handler', () => {
    render(<AnalysisModeView lines={['x']} isRunning analysisPhase={phase} />);
    expect(screen.queryByLabelText('Cancel analysis')).toBeNull();
  });
});

describe('progress chrome is translated', () => {
  it('renders no hardcoded English chrome literals in the analysis view source', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/shared/components/progress/AnalysisModeView.tsx'),
      'utf8',
    );
    for (const literal of ["'Analyzing...'", "'Complete'", 'Step {', '} lines']) {
      expect(src).not.toContain(literal);
    }
    expect(src).toContain('pe.step_progress');
    expect(src).toContain('pe.lines_count');
  });

  it('detects phases by key, not by English label', async () => {
    const { detectAnalysisPhase, detectTransformPhase } = await import('../phaseDetection');
    const analysis = detectAnalysisPhase(['[system] design analysis started']);
    expect(analysis).toMatchObject({ step: 1, total: 7, labelKey: 'analysis_phase_init' });
    expect(analysis).not.toHaveProperty('label');

    const transform = detectTransformPhase(['reading workflow'], 'running');
    expect(transform).toMatchObject({ labelKey: 'transform_phase_parsing' });

    // No keyword match still yields a KEY, never an English fallback string.
    expect(detectTransformPhase(['nothing recognisable'], 'running')).toMatchObject({
      labelKey: 'transform_phase_analyzing',
    });
    expect(detectAnalysisPhase([])).toBeNull();
  });

  it('resolves every phase key against en.json', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const en = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.json'), 'utf8'),
    ) as { shared: { progress_extra: Record<string, string> } };
    const pe = en.shared.progress_extra;
    for (const key of Object.keys(pe).filter((k) => k.includes('_phase_'))) {
      expect(pe[key], key).toBeTruthy();
    }
    expect(pe.analyzing).toBeTruthy();
    expect(pe.lines_count).toContain('{count}');
  });
});
