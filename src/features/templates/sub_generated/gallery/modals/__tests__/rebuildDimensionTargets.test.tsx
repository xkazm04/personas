import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { RebuildModal } from '../RebuildModal';
import { composeRebuildDirection } from '../RebuildDimensionTargets';

/** A design whose prompt + summary are filled and whose tools/triggers are not. */
const DESIGN = {
  structured_prompt: {
    identity: 'A long enough identity string for the prompt dimension',
    instructions: 'Instructions long enough to clear the fifty character threshold in the scorer',
    toolGuidance: 'use the tools carefully',
  },
  summary: 'A summary that comfortably exceeds the fifty character minimum the scorer applies',
  suggested_tools: [],
  suggested_triggers: [],
};

const review = (): PersonaDesignReview =>
  ({
    id: 'r1',
    test_case_id: 'tpl-1',
    test_case_name: 'Morning digest',
    instruction: 'Summarise the overnight inbox',
    design_result: JSON.stringify(DESIGN),
    use_case_flows: null,
    test_run_id: 'seed-category-v1',
  }) as unknown as PersonaDesignReview;

function openModal(onStartRebuild = vi.fn()) {
  render(
    <RebuildModal
      isOpen
      onClose={vi.fn()}
      review={review()}
      phase="idle"
      lines={[]}
      error={null}
      onStartRebuild={onStartRebuild}
      onCancel={vi.fn()}
    />,
  );
  return onStartRebuild;
}

describe('RebuildModal dimension targets', () => {
  it('lists all 9 dimensions with a pass/fail verdict', () => {
    openModal();
    expect(screen.getByTestId('rebuild-dimension-targets')).toBeTruthy();
    for (const dim of ['prompt', 'tools', 'triggers', 'connectors', 'flows', 'events', 'notifications', 'summary', 'service_flow']) {
      expect(screen.getByTestId(`rebuild-dim-${dim}`)).toBeTruthy();
    }
    // The fixture fills prompt + summary and leaves tools/triggers empty.
    expect(screen.getByTestId('rebuild-dim-prompt-passed')).toBeTruthy();
    expect(screen.getByTestId('rebuild-dim-summary-passed')).toBeTruthy();
    expect(screen.getByTestId('rebuild-dim-tools-failed')).toBeTruthy();
    expect(screen.getByTestId('rebuild-dim-triggers-failed')).toBeTruthy();
  });

  it('hands the checked dimensions to the rebuild caller', () => {
    const onStartRebuild = openModal();

    fireEvent.click(screen.getByTestId('rebuild-dim-tools').querySelector('[role="checkbox"]')!);
    fireEvent.click(screen.getByTestId('rebuild-dim-triggers').querySelector('[role="checkbox"]')!);
    fireEvent.click(screen.getByText(en.templates.rebuild_modal.start_rebuild));

    expect(onStartRebuild).toHaveBeenCalledTimes(1);
    const [, targets] = onStartRebuild.mock.calls[0] as [string, string[]];
    expect(targets).toEqual(['tools', 'triggers']);
  });

  it('unchecking removes the target again', () => {
    const onStartRebuild = openModal();
    const toolsBox = screen.getByTestId('rebuild-dim-tools').querySelector('[role="checkbox"]')!;

    fireEvent.click(toolsBox);
    fireEvent.click(toolsBox);
    fireEvent.click(screen.getByText(en.templates.rebuild_modal.start_rebuild));

    const [, targets] = onStartRebuild.mock.calls[0] as [string, string[]];
    expect(targets).toEqual([]);
  });

  it('starts with nothing checked, which is the whole-entry rebuild it always was', () => {
    const onStartRebuild = openModal();
    fireEvent.click(screen.getByText(en.templates.rebuild_modal.start_rebuild));
    const [direction, targets] = onStartRebuild.mock.calls[0] as [string, string[]];
    expect(targets).toEqual([]);
    expect(direction).toBe('');
  });
});

describe('composeRebuildDirection', () => {
  it('names the targets so the rebuild stays local to them', () => {
    const out = composeRebuildDirection('', ['tools', 'triggers']);
    expect(out).toContain('tools, triggers');
    expect(out).toContain('Leave every other dimension');
  });

  it('keeps the user direction alongside the scope', () => {
    const out = composeRebuildDirection('  prefer Slack  ', ['tools']);
    expect(out).toContain('tools');
    expect(out).toContain('prefer Slack');
  });

  it('passes a free-text-only rebuild through unchanged', () => {
    expect(composeRebuildDirection('make it terser', [])).toBe('make it terser');
  });

  it('is empty when neither was given, so the backend sees no instruction', () => {
    expect(composeRebuildDirection('   ', [])).toBe('');
  });
});
