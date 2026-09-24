import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The chip's two inert branches are decided by ContextCoverage, which reads the
// stores only for the goal/idea/cost jumps it also hosts.
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector({}),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (selector: (s: Record<string, unknown>) => unknown) => selector({}),
}));
vi.mock('@/features/plugins/companion/guidance/appActions', () => ({ openGoalsBoard: vi.fn() }));

import type { DevUseCase } from '@/lib/bindings/DevUseCase';

import { ContextCoverage } from '../contextLedgerShared';
import { FeatureChip } from '../FeatureChip';
import { sortFeatures } from '../FeaturePopover';
import type { FeatureChipContext } from '../featureChipContext';

const t = {
  uc_title: 'Features',
  council_not_scanned: 'not scanned',
  council_not_scanned_tooltip: 'This project has {count} features, and none of them is linked to a context yet.',
  council_chip_tooltip: '{count} features slice this context.',
  // INVARIANT: FeatureChip reads only these leaves of the dev_tools slice.
} as unknown as Parameters<typeof FeatureChip>[0]['t'];

function useCase(over: Partial<DevUseCase> & { id: string; name: string }): DevUseCase {
  return {
    slug: over.id,
    context_ids: [],
    status: 'active',
    kind: 'capability',
    tier: 'standard',
    ...over,
  } as unknown as DevUseCase;
}

const project = { projectId: 'p1', projectName: 'Personas', rootPath: 'C:/repos/personas' };

function chipCtx(over: Partial<FeatureChipContext> = {}): FeatureChipContext {
  return {
    project,
    groupIdByContext: new Map(),
    featuresUnlinked: false,
    featureTotal: 0,
    ...over,
  };
}

describe('FeatureChip — no feature, no interactivity', () => {
  it('is a button when the context has features', () => {
    render(
      <FeatureChip
        contextName="agents-editor"
        useCases={[useCase({ id: 'a', name: 'Agent Execution' })]}
        chip={chipCtx({ featureTotal: 1 })}
        t={t}
      />,
    );
    const chip = screen.getByTestId('context-feature-chip');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('is inert when the context has no features and the link layer is real', () => {
    render(
      <ContextCoverage
        fileCount={1}
        useCaseCount={0}
        goalCount={0}
        ideaCount={0}
        kpiCount={0}
        contextName="agents-editor"
        contextUseCases={[]}
        chip={chipCtx({ featureTotal: 4, featuresUnlinked: false })}
        t={t}
      />,
    );
    expect(screen.queryByTestId('context-feature-chip')).not.toBeInTheDocument();
    expect(screen.queryByText('not scanned')).not.toBeInTheDocument();
  });

  // The live Personas state: 12 features, 0 context links. Rendering `0` would
  // report an unscanned link layer as a measured absence.
  it("says 'not scanned' rather than zero when NO feature is linked anywhere", () => {
    render(
      <FeatureChip
        contextName="agents-editor"
        useCases={[]}
        chip={chipCtx({ featureTotal: 12, featuresUnlinked: true })}
        t={t}
      />,
    );
    expect(screen.getByText('not scanned')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('context-feature-chip')).not.toBeInTheDocument();
  });

  it('stays display-only when no project is active', () => {
    render(
      <ContextCoverage
        fileCount={1}
        useCaseCount={1}
        goalCount={0}
        ideaCount={0}
        kpiCount={0}
        contextName="agents-editor"
        contextUseCases={[useCase({ id: 'a', name: 'A' })]}
        chip={chipCtx({ project: null })}
        t={t}
      />,
    );
    expect(screen.queryByTestId('context-feature-chip')).not.toBeInTheDocument();
  });
});

describe('the popover list shares the chip predicate', () => {
  it('sorts by name ascending, locale-aware, without mutating the input', () => {
    const input = [
      useCase({ id: '1', name: 'Zone control' }),
      useCase({ id: '2', name: 'agent execution' }),
      useCase({ id: '3', name: 'Ålesund sync' }),
      useCase({ id: '4', name: 'Credential vault' }),
    ];
    const sorted = sortFeatures(input);
    expect(sorted.map((u) => u.name)).toEqual([
      'agent execution',
      'Ålesund sync',
      'Credential vault',
      'Zone control',
    ]);
    expect(input[0]?.name).toBe('Zone control');
  });
});
