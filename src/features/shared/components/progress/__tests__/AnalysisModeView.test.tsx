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
