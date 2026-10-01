/**
 * Dossier (WP9): the variant renders every fixture in both modes, each tile is
 * one keyboard-reachable control named by its section, the L2 boards reach L3
 * through `onOpenDetail`, unmeasured numbers render as "not measured" (asserted
 * on data attributes, never on pixels), and reduced motion drops the pulse and
 * the layout travel.
 *
 * The i18n layer is not mocked. The English `twin` section is seeded from the
 * authoritative `locales/en.json` (the per-section split under
 * `section-locales/` is a derived artifact the translation ritual regenerates),
 * so a key the variant reads that does not exist in the catalog still fails.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/i18n/locales/en.json';
import { setLoadedEnglishSection } from '@/i18n/englishSections';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import {
  FIXTURE_DELTA_INSTANT, FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH,
} from '../../../__fixtures__/blueprintFixtures';
import DossierBlueprint from '../index';

beforeAll(() => {
  setLoadedEnglishSection('twin', en.twin);
});

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
  const view = render(<DossierBlueprint {...props} />);
  return { ...view, props };
}

const FIXTURES: Array<[string, TwinBlueprintModel]> = [
  ['empty', FIXTURE_EMPTY],
  ['one channel', FIXTURE_ONE_CHANNEL],
  ['rich', FIXTURE_RICH],
];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];
const NAMES: Record<SectionId, string> = { identity: 'Identity', voice: 'Voice', knowledge: 'Knowledge', training: 'Training' };

describe('DossierBlueprint renders every fixture', () => {
  it.each(FIXTURES)('%s: detail L1, every L2 board and stage', (_name, model) => {
    const l1 = setup({ model });
    expect(screen.getByTestId('twin-blueprint-dossier')).toHaveAttribute('data-mode', 'detail');
    for (const s of SECTIONS) expect(screen.getByRole('button', { name: NAMES[s] })).toBeInTheDocument();
    l1.unmount();

    for (const focus of SECTIONS) {
      const l2 = setup({ model, focus });
      expect(screen.getByTestId('twin-blueprint-dossier')).toHaveAttribute('data-focus', focus);
      expect(screen.getByTestId(`dossier-board-${focus}`)).toBeInTheDocument();
      // The other three stay reachable as the rail.
      for (const other of SECTIONS.filter((s) => s !== focus)) {
        expect(screen.getByRole('button', { name: NAMES[other] })).toBeInTheDocument();
      }
      l2.unmount();
    }

    setup({ model, mode: 'stage', delta: FIXTURE_DELTA_RECONCILED, working: true });
    expect(screen.getByTestId('twin-blueprint-dossier')).toHaveAttribute('data-mode', 'stage');
    expect(screen.getByTestId('dossier-stage')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-working')).toBeInTheDocument();
  });

  it('folds channels past five into one "+N" row on layer one', () => {
    setup();
    const voice = screen.getByTestId('dossier-voice');
    expect(voice.querySelectorAll('[data-channel]')).toHaveLength(4);
    expect(within(screen.getByTestId('dossier-voice-more')).getByText('+5 more')).toBeInTheDocument();
  });
});

describe('tiles are the section controls', () => {
  it('Tab reaches each tile, named from t.twin.blueprint.sections, and Enter/Space/click open it', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Identity' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Voice' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Training' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }));
    expect(props.onFocus).toHaveBeenNthCalledWith(1, 'voice');
    expect(props.onFocus).toHaveBeenNthCalledWith(2, 'training');
    expect(props.onFocus).toHaveBeenNthCalledWith(3, 'knowledge');
  });

  it('a rail tile on L2 switches the board; Back returns to the overview', () => {
    const { props } = setup({ focus: 'voice' });
    fireEvent.click(screen.getByRole('button', { name: 'Training' }));
    expect(props.onFocus).toHaveBeenCalledWith('training');
    fireEvent.click(screen.getByTestId('dossier-back'));
    expect(props.onFocus).toHaveBeenLastCalledWith(null);
  });

  it('stage tiles are not controls: the question card owns the keyboard', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('L2 opens L3 through onOpenDetail', () => {
  it('Full detail opens the section; a channel head opens that channel', () => {
    const { props } = setup({ focus: 'voice' });
    fireEvent.click(screen.getByTestId('dossier-open-detail'));
    expect(props.onOpenDetail).toHaveBeenCalledWith('voice');
    fireEvent.keyDown(screen.getByTestId('dossier-open-channel-email'), { key: 'Enter' });
    expect(props.onOpenDetail).toHaveBeenLastCalledWith('voice', 'email');
  });

  it('a goal row opens that goal', () => {
    const { props } = setup({ focus: 'training' });
    fireEvent.click(screen.getByTestId('dossier-goal-g3'));
    expect(props.onOpenDetail).toHaveBeenLastCalledWith('training', 'g3');
    fireEvent.keyDown(screen.getByTestId('dossier-goal-g5'), { key: ' ' });
    expect(props.onOpenDetail).toHaveBeenLastCalledWith('training', 'g5');
  });
});

describe('null renders "not measured", never 0', () => {
  const UNMEASURED: TwinBlueprintModel = {
    ...FIXTURE_ONE_CHANNEL,
    identity: { ...FIXTURE_ONE_CHANNEL.identity, bioChars: null },
    voice: { channels: [{ ...FIXTURE_ONE_CHANNEL.voice.channels[0]!, dims: null }] },
    knowledge: { memories: { approved: null, pending: null, rejected: null }, facts: null, kbBound: false },
    training: { ...FIXTURE_ONE_CHANNEL.training, goals: [] },
    samples: { open: null },
  };

  it('layer one marks each unmeasured quantity', () => {
    setup({ model: UNMEASURED });
    expect(screen.getByTestId('dossier-bio-none')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-bio-figure')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-print-generic')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-memories-none')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-mem-approved')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-facts')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-goals-none')).toHaveAttribute('data-measured', 'false');
    // Coverage the section cannot measure yet: knowledge (no approved count) and training (no plan).
    expect(screen.getByTestId('dossier-gauge-knowledge')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-gauge-training')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-gauge-identity')).toHaveAttribute('data-measured', 'true');
  });

  it('the Knowledge board marks the open proposals it could not count', () => {
    setup({ model: UNMEASURED, focus: 'knowledge' });
    expect(screen.getByTestId('dossier-samples-open')).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('dossier-mem-pending')).toHaveAttribute('data-measured', 'false');
  });

  it('a measured zero is drawn as a measured zero', () => {
    setup({ model: FIXTURE_EMPTY });
    expect(screen.getByTestId('dossier-mem-approved')).toHaveAttribute('data-measured', 'true');
    expect(screen.getByTestId('dossier-mem-approved')).toHaveTextContent('0');
  });
});

describe('stage plays the delta', () => {
  it('instant: the answered tile reads "recorded" and holds a ghost where the gain will land', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_INSTANT });
    const readout = screen.getByTestId('dossier-readout');
    expect(readout).toHaveAttribute('data-phase', 'instant');
    expect(readout).toHaveTextContent('Answer recorded');
    expect(readout.querySelector('.k-ghost')).not.toBeNull();
    expect(screen.getByTestId('dossier-cell-training')).toHaveAttribute('data-hot', 'true');
  });

  it('reconciled: the gain and the why, the gain segment on the goal meter, a pulse on the tile', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    const readout = screen.getByTestId('dossier-readout');
    expect(readout).toHaveAttribute('data-phase', 'reconciled');
    expect(readout).toHaveTextContent('Coverage +12%');
    expect(readout).toHaveTextContent('Took a clear side and gave a reason from a real deal.');
    expect(screen.getByTestId('dossier-goal-meter-g5')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-gain')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-pulse-training')).toBeInTheDocument();
    expect(screen.queryByTestId('dossier-pulse-voice')).toBeNull();
  });
});

describe('reduced motion', () => {
  it('drops the pulse and the travel and marks the root', () => {
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED, reduced: true });
    expect(screen.getByTestId('twin-blueprint-dossier')).toHaveAttribute('data-motion', 'reduced');
    expect(screen.queryByTestId('dossier-pulse-training')).toBeNull();
    // The gain still lands, as a static segment.
    expect(screen.getByTestId('dossier-gain').getAttribute('style') ?? '').not.toMatch(/transform/);
    for (const s of SECTIONS) {
      expect(screen.getByTestId(`dossier-cell-${s}`).getAttribute('style') ?? '').not.toMatch(/transform/);
    }
  });

  it('detail cells carry no transform when reduced', () => {
    setup({ focus: 'voice', reduced: true });
    for (const s of SECTIONS) {
      expect(screen.getByTestId(`dossier-cell-${s}`).getAttribute('style') ?? '').not.toMatch(/transform/);
    }
  });
});
