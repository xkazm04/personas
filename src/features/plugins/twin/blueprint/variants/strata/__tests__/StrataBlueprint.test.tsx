/**
 * Strata (WP8): the variant renders every fixture in both modes, a plate is a
 * keyboard-reachable control named by its section, L2 opens L3 through
 * `onOpenDetail`, unmeasured numbers render as "not measured" (asserted on data
 * attributes, never on pixels), and reduced motion drops travel and loops.
 *
 * The i18n layer is NOT mocked: the real catalog fails the moment a key the
 * variant reads does not exist.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import {
  FIXTURE_DELTA_INSTANT, FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH,
} from '../../../__fixtures__/blueprintFixtures';
import StrataBlueprint from '../index';

function setup(over: Partial<BlueprintVariantProps> = {}) {
  const props: BlueprintVariantProps = {
    model: FIXTURE_RICH,
    mode: 'detail',
    focus: null,
    onFocus: vi.fn(),
    onOpenDetail: vi.fn(),
    delta: null,
    working: false,
    reduced: false,
    ...over,
  };
  const view = render(<StrataBlueprint {...props} />);
  return { ...view, props };
}

const FIXTURES: Array<[string, TwinBlueprintModel]> = [
  ['empty', FIXTURE_EMPTY],
  ['one channel', FIXTURE_ONE_CHANNEL],
  ['rich', FIXTURE_RICH],
];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];

describe('StrataBlueprint renders every fixture', () => {
  it.each(FIXTURES)('%s: detail L1, every L2 and stage', (_name, model) => {
    const l1 = setup({ model });
    expect(screen.getByTestId('twin-blueprint-strata')).toHaveAttribute('data-mode', 'detail');
    expect(screen.getAllByRole('button')).toHaveLength(4);
    l1.unmount();

    for (const focus of SECTIONS) {
      const l2 = setup({ model, focus });
      expect(screen.getByTestId('strata-panel')).toHaveAttribute('data-section', focus);
      l2.unmount();
    }

    setup({ model, mode: 'stage', delta: FIXTURE_DELTA_RECONCILED, working: true });
    expect(screen.getByTestId('twin-blueprint-strata')).toHaveAttribute('data-mode', 'stage');
    expect(screen.getByTestId('strata-readout')).toBeInTheDocument();
  });
});

describe('plates are the section controls', () => {
  it('Tab reaches each plate, named from t.twin.blueprint.sections, and Enter/Space/click focus it', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Training' }));

    const voice = screen.getByRole('button', { name: 'Voice' });
    fireEvent.keyDown(voice, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Identity' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(props.onFocus).toHaveBeenNthCalledWith(1, 'voice');
    expect(props.onFocus).toHaveBeenNthCalledWith(2, 'identity');
    expect(props.onFocus).toHaveBeenNthCalledWith(3, 'knowledge');
  });

  it('stage plates are not controls: the question card owns the keyboard', () => {
    const { props } = setup({ mode: 'stage' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('strata-plate-voice'));
    expect(props.onFocus).not.toHaveBeenCalled();
  });
});

describe('L2 opens L3 through onOpenDetail', () => {
  it('Full detail, a channel row (click and Enter) and Back', () => {
    const { props } = setup({ focus: 'voice' });
    fireEvent.click(screen.getByTestId('strata-open-detail'));
    fireEvent.click(screen.getByTestId('strata-channel-email'));
    fireEvent.keyDown(screen.getByTestId('strata-channel-slack'), { key: 'Enter' });
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(1, 'voice', undefined);
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(2, 'voice', 'email');
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(3, 'voice', 'slack');

    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    expect(props.onFocus).toHaveBeenCalledWith(null);
  });

  it('a goal row opens that goal; the receded plates switch section', () => {
    const { props } = setup({ focus: 'training' });
    fireEvent.click(screen.getByTestId('strata-goal-g5'));
    expect(props.onOpenDetail).toHaveBeenCalledWith('training', 'g5');
    // The lead plate is glass, not a control; the three in the rail are.
    expect(screen.queryByRole('button', { name: 'Training' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
    expect(props.onFocus).toHaveBeenCalledWith('voice');
  });
});

describe('null renders as not measured, never as zero', () => {
  const unmeasured: TwinBlueprintModel = {
    ...FIXTURE_EMPTY,
    identity: { ...FIXTURE_EMPTY.identity, bioChars: null },
    knowledge: { memories: { approved: null, pending: null, rejected: null }, facts: null, kbBound: false },
    samples: { open: null },
  };

  it('plates without a measure are flagged and hatched', () => {
    setup({ model: unmeasured });
    expect(screen.getByTestId('strata-plate-knowledge')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('strata-plate-knowledge')).toHaveAttribute('data-coverage', 'none');
    // No plan yet: training has no coverage to draw either.
    expect(screen.getByTestId('strata-plate-training')).toHaveAttribute('data-measured', 'false');
    // A measured zero stays a measured zero.
    expect(screen.getByTestId('strata-plate-identity')).toHaveAttribute('data-measured', 'true');
  });

  it('L2 figures print "-" and the bars hatch', () => {
    setup({ model: unmeasured, focus: 'knowledge' });
    const facts = screen.getByTestId('strata-item-facts');
    expect(within(facts).getByText('-')).toHaveAttribute('data-measured', 'false');
    expect(facts.querySelector('[data-measured="false"].strata-meter')).not.toBeNull();
    const samples = screen.getByTestId('strata-item-samples');
    expect(within(samples).getByText('-')).toHaveAttribute('data-measured', 'false');
    expect(within(screen.getByTestId('strata-item-memories')).getAllByText('-')).toHaveLength(3);
  });
});

describe('stage plays the delta', () => {
  it('instant: the answered plate lifts, a check lands on it, the readout says it is scoring', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_INSTANT });
    const lane = screen.getByTestId('strata-plate-training');
    expect(lane).toHaveAttribute('data-hot', 'true');
    expect(screen.getByTestId('strata-delta-chip')).toHaveAttribute('data-phase', 'instant');
    expect(screen.getByTestId('strata-readout')).toHaveAttribute('data-phase', 'instant');
    expect(screen.queryByTestId('strata-delta-why')).toBeNull();
  });

  it('reconciled: the gain and the reason land', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    expect(screen.getByTestId('strata-delta-chip')).toHaveAttribute('data-phase', 'reconciled');
    expect(screen.getByTestId('strata-delta-why')).toHaveTextContent(FIXTURE_DELTA_RECONCILED.why ?? '');
    expect(screen.getAllByTestId('strata-delta-gain')[0]).toHaveTextContent('12%');
  });
});

describe('reduced motion: fades only', () => {
  it('no travel, no loops while working', () => {
    setup({ mode: 'stage', working: true, delta: FIXTURE_DELTA_INSTANT, reduced: true });
    expect(screen.getByTestId('twin-blueprint-strata')).toHaveAttribute('data-motion', 'reduced');
    expect(document.querySelectorAll('[data-loop]')).toHaveLength(0);
    for (const s of SECTIONS) expect(screen.getByTestId(`strata-plate-${s}`)).toHaveAttribute('data-travel', 'off');
  });

  it('the same state with motion on does loop (the assertion above can fail)', () => {
    setup({ mode: 'stage', working: true, delta: FIXTURE_DELTA_INSTANT, reduced: false });
    expect(document.querySelector('[data-loop="scan"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-loop="breathe"]')).toHaveLength(4);
  });
});
