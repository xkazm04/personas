import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BrowserReportSections } from '../BrowserReportSections';
import { reviewTone } from '../decisionMarks';
import { intentTone } from '../intentColors';

/**
 * Three severity -> tone maps lived in this folder and disagreed: `reviewTone`
 * (LinkedDecisions) and `intentTone` (IssueList) draw a `low` defect info-blue
 * and `reviewTone` ignores case, while the browser report's private map drew
 * `low` neutral and read a model-written `Critical` / `HIGH` as neutral too, so
 * the most severe defect in a report could carry no accent at all.
 */
function defectAccents(severities: string[]): string[] {
  render(
    <BrowserReportSections
      steps={[{ label: 'open', result: 'fail' }]}
      defects={severities.map((severity, i) => ({ title: `Defect ${i}`, severity }))}
      consoleErrors={[]}
      securityNotes={[]}
    />,
  );
  const table = screen.getByTestId('companion-browser-report-defects');
  return severities.map((_, i) => {
    // UnifiedTableRow carries `border-l-2 <accent>` on the row element.
    const row = screen.getAllByText(`Defect ${i}`)[0]!.closest('.row-hover-lift');
    expect(row && table.contains(row)).toBe(true);
    return row!.className.split(/\s+/).find((c) => c.startsWith('border-l-') && c !== 'border-l-2') ?? '';
  });
}

describe('BrowserReportSections defect accents', () => {
  it('reads a capitalised severity as the severity it names', () => {
    const [critical, high] = defectAccents(['Critical', 'HIGH']);
    expect(critical).toBe('border-l-status-error/70');
    expect(high).toBe('border-l-status-error/70');
  });

  it('draws low the way the folder\'s other severity maps do', () => {
    expect(reviewTone('low')).toBe(intentTone('low'));
    const [low] = defectAccents(['low']);
    expect(low).toBe('border-l-status-info/70');
  });
});
