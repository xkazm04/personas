import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';
import { ReplayToolPanel } from '../ReplayToolPanel';
import { SubSpanBar } from '../../trace/SubSpanBar';

// The runner writes step_index 1-BASED (src-tauri/src/engine/runner/mod.rs:
// `step_counter += 1;` BEFORE `step_index: step_counter`). Every surface must
// therefore render it as written; adding 1 anywhere makes the Pipeline tab and
// the Replay tab disagree about the name of the same tool call.
function step(over: Partial<ToolCallStep> = {}): ToolCallStep {
  return {
    step_index: 1,
    tool_name: 'Read',
    input_preview: 'file.ts',
    output_preview: 'ok',
    started_at_ms: 0n,
    ended_at_ms: 100n,
    duration_ms: 100n,
    ...over,
  };
}

function numbersIn(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

describe('tool-call step numbering', () => {
  it('names the same step identically in ReplayToolPanel and SubSpanBar', () => {
    const s = step({ step_index: 7 });

    const panel = render(
      <ReplayToolPanel
        toolSteps={[s]}
        completedSteps={[s]}
        activeStep={null}
        forkPoint={null}
        onFork={() => {}}
      />,
    );
    // The step-number cell is the first tabular-nums code span in the card.
    const panelNumber = panel.container.querySelector('.typo-code.tabular-nums')!.textContent!.trim();

    const trace = render(
      <SubSpanBar step={s} parentStartMs={0} totalDurationMs={1000} pipelineStartMs={0} />,
    );
    // The step number only appears in the hover tooltip.
    fireEvent.mouseEnter(trace.container.firstElementChild!);
    const traceText = trace.container.textContent ?? '';

    expect(panelNumber).toBe('7');
    expect(numbersIn(traceText)).toContain('7');
    expect(traceText).not.toContain('#8');
  });

  it('offers to fork after the step the user clicked, by its own number', () => {
    const s = step({ step_index: 3 });
    const { container } = render(
      <ReplayToolPanel
        toolSteps={[s]}
        completedSteps={[s]}
        activeStep={null}
        forkPoint={null}
        onFork={() => {}}
      />,
    );
    const forkButton = container.querySelector('button[title]')!;
    expect(forkButton.getAttribute('title')).toContain('3');
    expect(forkButton.getAttribute('title')).not.toContain('4');
  });
});
