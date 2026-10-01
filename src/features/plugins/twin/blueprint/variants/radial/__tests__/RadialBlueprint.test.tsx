/**
 * Radial (WP10): the variant renders every fixture in both modes, a ring
 * segment is a keyboard-reachable control named by its section, L2 opens L3
 * through `onOpenDetail`, unmeasured numbers render as "not measured"
 * (asserted on data attributes, never on pixels), the stage plays both delta
 * phases, and reduced motion drops the zoom travel and every loop.
 *
 * The i18n layer is NOT mocked: the real catalog fails the moment a seeded key
 * the variant reads does not exist.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import {
  FIXTURE_DELTA_INSTANT, FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH,
} from '../../../__fixtures__/blueprintFixtures';
import RadialBlueprint from '../index';

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
  const view = render(<RadialBlueprint {...props} />);
  return { ...view, props };
}

const FIXTURES: Array<[string, TwinBlueprintModel]> = [
  ['empty', FIXTURE_EMPTY],
  ['one channel', FIXTURE_ONE_CHANNEL],
  ['rich', FIXTURE_RICH],
];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];

describe('RadialBlueprint renders every fixture', () => {
  it.each(FIXTURES)('%s: detail L1, every L2 and stage', (_name, model) => {
    const l1 = setup({ model });
    expect(screen.getByTestId('twin-blueprint-radial')).toHaveAttribute('data-mode', 'detail');
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByTestId('radial-hub')).toHaveTextContent([...model.identity.name][0] ?? '');
    l1.unmount();

    for (const focus of SECTIONS) {
      const l2 = setup({ model, focus });
      expect(screen.getByTestId('radial-focus')).toHaveAttribute('data-section', focus);
      expect(screen.getByTestId('twin-blueprint-radial')).toHaveAttribute('data-focus', focus);
      l2.unmount();
    }

    setup({ model, mode: 'stage', delta: FIXTURE_DELTA_RECONCILED, working: true });
    expect(screen.getByTestId('twin-blueprint-radial')).toHaveAttribute('data-mode', 'stage');
    expect(screen.getByTestId('radial-readout')).toBeInTheDocument();
  });
});

describe('segments are the section controls', () => {
  it('Tab reaches each segment, named from t.twin.blueprint.sections, and Enter/Space/click focus it', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Identity' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Voice' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Voice' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Training' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(props.onFocus).toHaveBeenNthCalledWith(1, 'voice');
    expect(props.onFocus).toHaveBeenNthCalledWith(2, 'training');
    expect(props.onFocus).toHaveBeenNthCalledWith(3, 'knowledge');
  });

  it('the outside label is a second pointer target for the same section', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('radial-label-identity'));
    expect(props.onFocus).toHaveBeenCalledWith('identity');
  });

  it('stage segments are not controls: the question card owns the keyboard', () => {
    const { props } = setup({ mode: 'stage' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('radial-seg-voice'));
    expect(props.onFocus).not.toHaveBeenCalled();
  });

  it('while L2 is open the overview is hidden from the keyboard and assistive tech', () => {
    setup({ focus: 'voice' });
    expect(screen.queryByRole('button', { name: 'Identity' })).toBeNull();
    expect(document.querySelector('.rd-l1')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('L2 opens L3 through onOpenDetail', () => {
  it('Voice: Full detail, a channel row (click and Enter) and Back', () => {
    const { props } = setup({ focus: 'voice' });
    fireEvent.click(screen.getByTestId('radial-open-detail'));
    fireEvent.click(screen.getByTestId('radial-channel-email'));
    fireEvent.keyDown(screen.getByTestId('radial-channel-slack'), { key: 'Enter' });
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(1, 'voice', undefined);
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(2, 'voice', 'email');
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(3, 'voice', 'slack');

    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    expect(props.onFocus).toHaveBeenCalledWith(null);
  });

  it('Training: a goal row and a topic row open that item', () => {
    const { props } = setup({ focus: 'training' });
    fireEvent.click(screen.getByTestId('radial-goal-g5'));
    fireEvent.keyDown(screen.getByTestId('radial-topic-opinions'), { key: ' ' });
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(1, 'training', 'g5');
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(2, 'training', 'opinions');
  });

  it('a channel row lights its spoke on the ring while hovered', () => {
    setup({ focus: 'voice' });
    fireEvent.pointerEnter(screen.getByTestId('radial-channel-teams'));
    const spoke = screen.getByTestId('radial-focus').querySelector('[data-channel="teams"]');
    expect(spoke).toHaveAttribute('data-hot', 'true');
  });
});

describe('null renders as not measured, never as zero', () => {
  const unmeasured: TwinBlueprintModel = {
    ...FIXTURE_EMPTY,
    identity: { ...FIXTURE_EMPTY.identity, bioChars: null },
    knowledge: { memories: { approved: null, pending: null, rejected: null }, facts: null, kbBound: false },
    samples: { open: null },
  };

  it('segments and glyphs without a measure are flagged and hatched', () => {
    setup({ model: unmeasured });
    expect(screen.getByTestId('radial-seg-knowledge')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('radial-seg-knowledge')).toHaveAttribute('data-coverage', 'none');
    expect(screen.getByTestId('radial-unmeasured-knowledge')).toBeInTheDocument();
    // No plan yet: training has no coverage to draw either.
    expect(screen.getByTestId('radial-seg-training')).toHaveAttribute('data-measured', 'false');
    // A measured zero stays a measured zero.
    expect(screen.getByTestId('radial-seg-identity')).toHaveAttribute('data-measured', 'true');
    expect(screen.getByTestId('radial-bio')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('radial-memories')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('radial-facts')).toHaveAttribute('data-measured', 'false');
  });

  it('labels print "-" for an unmeasured figure, and a measured zero as 0', () => {
    setup({ model: unmeasured });
    const knowledge = screen.getByTestId('radial-label-knowledge');
    expect(within(knowledge).getAllByText('-')[0]).toHaveAttribute('data-measured', 'false');
    const identity = screen.getByTestId('radial-label-identity');
    expect(within(identity).getByText('0%')).toBeInTheDocument();
  });

  it('L2 figures print "-" and the rings hatch', () => {
    const view = setup({ model: unmeasured, focus: 'knowledge' });
    expect(within(screen.getByTestId('radial-key-approved')).getByText('-')).toHaveAttribute('data-measured', 'false');
    expect(within(screen.getByTestId('radial-key-facts')).getByText('-')).toHaveAttribute('data-measured', 'false');
    const focus = screen.getByTestId('radial-focus');
    expect(within(focus).getByTestId('radial-memories')).toHaveAttribute('data-measured', 'false');
    view.unmount();

    setup({ model: unmeasured, focus: 'voice' });
    expect(within(screen.getByTestId('radial-samples-open')).getByText('-')).toHaveAttribute('data-measured', 'false');
  });
});

describe('stage plays the delta', () => {
  it('instant: the answered segment leads, the topic cell lights a tick, the readout says it is scoring', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_INSTANT });
    expect(screen.getByTestId('radial-stage')).toHaveAttribute('data-lead', 'training');
    expect(screen.getByTestId('radial-seg-voice')).toHaveAttribute('data-dim', 'true');
    expect(screen.getByTestId('radial-delta')).toHaveAttribute('data-phase', 'instant');
    expect(document.querySelector('[data-key="opinions"] [data-testid="radial-lit"]')).not.toBeNull();
    expect(screen.queryByTestId('radial-gain-arc')).toBeNull();
    expect(screen.getByTestId('radial-readout')).toHaveAttribute('data-phase', 'instant');
    expect(screen.queryByTestId('radial-delta-why')).toBeNull();
  });

  it('reconciled: the gain arc grows in and the gain and the reason land', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    expect(screen.getByTestId('radial-delta')).toHaveAttribute('data-phase', 'reconciled');
    expect(screen.getByTestId('radial-gain-arc')).toBeInTheDocument();
    expect(screen.getByTestId('radial-delta-why')).toHaveTextContent(FIXTURE_DELTA_RECONCILED.why ?? '');
    expect(screen.getByTestId('radial-delta-gain')).toHaveTextContent('12%');
  });

  it('a delta about a channel with no goal lights the voice segment', () => {
    setup({ mode: 'stage', delta: { ...FIXTURE_DELTA_INSTANT, goalId: null, topicId: null, kind: 'reply_drill', channel: 'email' } });
    expect(screen.getByTestId('radial-stage')).toHaveAttribute('data-lead', 'voice');
    expect(document.querySelector('[data-channel="email"]')).toHaveAttribute('data-hot', 'true');
  });
});

describe('reduced motion: fades only', () => {
  it('no loops while working', () => {
    setup({ mode: 'stage', working: true, delta: FIXTURE_DELTA_INSTANT, reduced: true });
    expect(screen.getByTestId('twin-blueprint-radial')).toHaveAttribute('data-motion', 'reduced');
    expect(document.querySelectorAll('[data-loop]')).toHaveLength(0);
  });

  it('the same state with motion on does loop (the assertion above can fail)', () => {
    setup({ mode: 'stage', working: true, delta: FIXTURE_DELTA_INSTANT, reduced: false });
    expect(document.querySelector('[data-loop="orbit"]')).not.toBeNull();
    expect(document.querySelector('[data-loop="dots"]')).not.toBeNull();
  });

  it('no zoom travel into L2: the overview only fades', () => {
    setup({ focus: 'voice', reduced: true });
    const l1 = document.querySelector<HTMLElement>('.rd-l1');
    expect(l1).toHaveAttribute('data-zoom', 'voice');
    expect(l1?.style.transform).toBe('');
  });

  it('with motion on the overview zooms into the segment (the assertion above can fail)', () => {
    setup({ focus: 'voice', reduced: false });
    expect(document.querySelector<HTMLElement>('.rd-l1')?.style.transform).toMatch(/scale\(/);
  });
});
