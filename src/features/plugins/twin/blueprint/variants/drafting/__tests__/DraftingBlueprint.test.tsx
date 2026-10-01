/**
 * Drafting sheet (WP7): the variant renders every fixture in both modes, a
 * region is a keyboard-reachable control named by its section, L2 opens L3
 * through `onOpenDetail`, unmeasured numbers render as "not measured"
 * (asserted on data attributes, never on pixels), stage mode plays both delta
 * phases, and reduced motion drops the pen, the loops and the build-up.
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
import DraftingBlueprint from '../index';

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
  const view = render(<DraftingBlueprint {...props} />);
  return { ...view, props };
}

const FIXTURES: Array<[string, TwinBlueprintModel]> = [
  ['empty', FIXTURE_EMPTY],
  ['one channel', FIXTURE_ONE_CHANNEL],
  ['rich', FIXTURE_RICH],
];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];
const root = () => screen.getByTestId('twin-blueprint-drafting');

describe('DraftingBlueprint renders every fixture', () => {
  it.each(FIXTURES)('%s: detail L1, every L2, and stage in both delta phases and working', (_name, model) => {
    const l1 = setup({ model });
    expect(root()).toHaveAttribute('data-mode', 'detail');
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`)).toBeInTheDocument();
    expect(screen.getByTestId('twd-title-block')).toHaveTextContent(model.identity.name);
    l1.unmount();

    for (const focus of SECTIONS) {
      const l2 = setup({ model, focus });
      expect(root()).toHaveAttribute('data-focus', focus);
      expect(screen.getByTestId(`twd-focus-${focus}`)).toBeInTheDocument();
      l2.unmount();
    }

    for (const delta of [FIXTURE_DELTA_INSTANT, FIXTURE_DELTA_RECONCILED, null]) {
      const st = setup({ model, mode: 'stage', delta, working: delta === null });
      expect(root()).toHaveAttribute('data-mode', 'stage');
      expect(screen.getByTestId('twd-card-well')).toBeInTheDocument();
      expect(screen.getByTestId('twd-notes')).toBeInTheDocument();
      st.unmount();
    }
  });
});

describe('regions are the section controls', () => {
  it('Tab reaches each region in order, named from t.twin.blueprint.sections; Enter, Space and click zoom', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Identity' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Voice' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Voice' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Knowledge' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Training' }));
    expect(props.onFocus).toHaveBeenNthCalledWith(1, 'voice');
    expect(props.onFocus).toHaveBeenNthCalledWith(2, 'knowledge');
    expect(props.onFocus).toHaveBeenNthCalledWith(3, 'training');
  });

  it('stage regions are drawings, not controls: the question card owns the keyboard', () => {
    const { props } = setup({ mode: 'stage' });
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`)).not.toHaveAttribute('role');
    fireEvent.click(screen.getByTestId('twd-region-voice'));
    expect(props.onFocus).not.toHaveBeenCalled();
  });
});

describe('L2 opens L3 through onOpenDetail', () => {
  it('Voice: Full detail, a channel row, and Back', () => {
    const { props } = setup({ focus: 'voice' });
    fireEvent.click(screen.getByRole('button', { name: /Full detail/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(1, 'voice');
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(2, 'voice', 'email');

    fireEvent.click(screen.getByRole('button', { name: /Back to overview/ }));
    expect(props.onFocus).toHaveBeenCalledWith(null);
  });

  it('Training: a topic (click) and a goal (Enter) open their own detail', () => {
    const { props } = setup({ focus: 'training' });
    fireEvent.click(screen.getByRole('button', { name: 'Tech Opinions' }));
    const goal = FIXTURE_RICH.training.goals.find((g) => g.id === 'g5')!;
    fireEvent.keyDown(screen.getByRole('button', { name: goal.title }), { key: 'Enter' });
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(1, 'training', 'opinions');
    expect(props.onOpenDetail).toHaveBeenNthCalledWith(2, 'training', 'g5');
  });
});

describe('null renders as not measured, never as zero', () => {
  const unmeasured: TwinBlueprintModel = {
    ...FIXTURE_ONE_CHANNEL,
    identity: { ...FIXTURE_ONE_CHANNEL.identity, bioChars: null },
    voice: { channels: [{ channel: 'generic', exemplars: 1, rules: 0, hasDirectives: false, dims: null, origin: 'manual' }] },
    knowledge: { memories: { approved: null, pending: null, rejected: null }, facts: null, kbBound: false },
    training: { ...FIXTURE_ONE_CHANNEL.training, goals: [] },
    samples: { open: null },
  };

  it('L1: the regions and marks without a measure are flagged', () => {
    setup({ model: unmeasured });
    expect(screen.getByTestId('twd-region-knowledge')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('twd-region-knowledge')).toHaveAttribute('data-ink', 'unmeasured');
    // No plan yet: training has no coverage to draw either.
    expect(screen.getByTestId('twd-region-training')).toHaveAttribute('data-measured', 'false');
    // A measured share stays measured.
    expect(screen.getByTestId('twd-region-identity')).toHaveAttribute('data-measured', 'true');
    for (const kind of ['approved', 'awaiting', 'rejected']) {
      expect(document.querySelector(`[data-tally="${kind}"]`)).toHaveAttribute('data-measured', 'false');
    }
    const identity = screen.getByTestId('twd-region-identity');
    expect(identity.querySelector('[data-measured="false"]')).not.toBeNull();
    const voice = screen.getByTestId('twd-region-voice');
    expect(voice.querySelector('[data-channel="generic"] [data-measured="false"]')).not.toBeNull();
  });

  it('L2: knowledge prints "-" for the facts and the samples to review', () => {
    setup({ model: unmeasured, focus: 'knowledge' });
    const zoom = screen.getByTestId('twd-focus-knowledge');
    expect(zoom.querySelectorAll('[data-tally][data-measured="false"]').length).toBe(4);
    expect(within(zoom).getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  it('stage: the memory composition is hatched, not an empty bar', () => {
    setup({ model: unmeasured, mode: 'stage' });
    const knowledge = screen.getByTestId('twd-region-knowledge');
    expect(knowledge.querySelector('[data-measured="false"]')).not.toBeNull();
  });
});

describe('stage plays the delta', () => {
  it('instant: the answered topic is the target and the notes say it is recorded', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_INSTANT });
    expect(document.querySelector('[data-topic="opinions"]')).toHaveAttribute('data-delta-target', 'true');
    expect(document.querySelector('[data-goal="g5"]')).toHaveAttribute('data-delta-target', 'true');
    const notes = screen.getByTestId('twd-notes');
    expect(notes).toHaveTextContent('Answer recorded');
    expect(notes).toHaveTextContent('Tech Opinions');
    expect(notes).toHaveTextContent('Scoring your answer');
  });

  it('reconciled: the gain and the reason land in the notes', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    const notes = screen.getByTestId('twd-notes');
    expect(notes).toHaveTextContent('Coverage +12%');
    expect(notes).toHaveTextContent(FIXTURE_DELTA_RECONCILED.why ?? '');
    expect(notes.querySelector('[data-note]')).toHaveAttribute('data-note', 's-41:reconciled');
  });

  it('working with no question: the open middle is the waiting surface, and it loops', () => {
    setup({ model: FIXTURE_EMPTY, mode: 'stage', working: true });
    expect(root()).toHaveAttribute('data-working', 'true');
    expect(screen.getByTestId('twd-working')).toHaveTextContent('Reading your answers');
    expect(document.querySelector('[data-live="true"]')).not.toBeNull();
  });
});

describe('reduced motion: fades only', () => {
  const hasMotionTransform = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[style]')).some((el) => /scale\(|translate/.test(el.getAttribute('style') ?? ''));

  it('stage, working and mid-delta: no pen, no loop, no transform, the whole sheet drawn at once', () => {
    setup({ mode: 'stage', working: true, delta: FIXTURE_DELTA_INSTANT, reduced: true });
    expect(root()).toHaveAttribute('data-reduced', 'true');
    expect(screen.queryByTestId('twd-pen')).toBeNull();
    expect(document.querySelectorAll('[data-live="true"]')).toHaveLength(0);
    for (const s of SECTIONS) expect(screen.getByTestId(`twd-region-${s}`)).toHaveAttribute('data-drawn', 'true');
    expect(hasMotionTransform()).toBe(false);
  });

  it('a zoom opened under reduced motion fades rather than grows', () => {
    setup({ focus: 'training', reduced: true });
    expect(screen.getByTestId('twd-focus-training')).toHaveAttribute('data-zoom', 'fade');
    expect(hasMotionTransform()).toBe(false);
  });

  it('the same stage with motion on does loop and builds up (the assertions above can fail)', () => {
    setup({ mode: 'stage', working: true, reduced: false });
    expect(document.querySelectorAll('[data-live="true"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId('twd-region-voice')).toHaveAttribute('data-drawn', 'false');
  });
});
