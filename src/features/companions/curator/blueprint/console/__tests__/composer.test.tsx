/**
 * The argument field is a DIFFERENT AFFORDANCE in each of the three
 * invocation states, not one field wearing three labels.
 *
 * The badge test beside this one holds the WORDS apart. This holds the
 * CONTROL apart: a composer that showed "nobody wrote down how to invoke
 * this" and then accepted an empty submit would have told the operator the
 * truth and then acted as though it had not.
 */
import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

import type { BlueprintStrings, BlueprintWords } from '../../words';
import { BlueprintWordsProvider } from '../../words';
import { RequestComposer } from '../RequestComposer';

import { BARE, TAKES_ARGUMENT, UNKNOWN } from './fixture';

const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint.console;
const SKILLS = [BARE, TAKES_ARGUMENT, UNKNOWN];

/** Mount the composer and pick one skill by typing its exact name. */
function pick(skill: CuratorSkill) {
  const filed: unknown[] = [];
  const view = render(
    <BlueprintWordsProvider value={words}>
      <RequestComposer
        skills={SKILLS}
        onFile={async (input) => {
          filed.push(input);
        }}
      />
    </BlueprintWordsProvider>,
  );
  const field = view.container.querySelector('#cb-skill-field');
  if (!(field instanceof HTMLInputElement)) throw new Error('no skill field');
  // The listbox opens on FOCUS, not on having candidates: an empty query ranks
  // every skill, so a panel keyed on candidates alone would sit open over the
  // ledger from the moment the page painted.
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: skill.name } });
  const option = view.container.querySelector('[data-testid="quick-dispatch-suggestion-item"]');
  if (!option) throw new Error('the typeahead offered nothing for ' + skill.name);
  fireEvent.mouseDown(option);
  return { view, filed };
}

function parts(container: HTMLElement) {
  const argument = container.querySelector('#cb-argument-field');
  const label = container.querySelector('label[for="cb-argument-field"]');
  const submit = container.querySelector('[data-testid="curator-file-request"]');
  return {
    label: label?.textContent ?? '',
    required: argument instanceof HTMLInputElement ? argument.required : null,
    disabled: submit instanceof HTMLButtonElement ? submit.disabled : null,
    need: container.querySelector('[data-role="cb-composer"]')?.getAttribute('data-need'),
  };
}

describe('three invocation states, three affordances', () => {
  it('labels the field differently and demands differently in each', () => {
    // One mount at a time: three composers alive at once would put three
    // `#cb-skill-field` ids in one document, which is not a state the app can
    // ever reach and not one worth asserting against.
    const shown = SKILLS.map((s) => {
      const read = parts(pick(s).view.container);
      cleanup();
      return read;
    });
    expect(shown.map((p) => p.need)).toEqual(['optional', 'required', 'unknown']);
    expect(shown.map((p) => p.label)).toEqual([
      W.argument_optional,
      W.argument_required,
      W.argument_unknown,
    ]);
    // Three distinct labels, and the unknown one is not the bare one.
    expect(new Set(shown.map((p) => p.label)).size).toBe(3);
    expect(shown.map((p) => p.required)).toEqual([false, true, true]);
  });

  it('arms the file button for a bare-runnable skill with an empty argument', () => {
    const { view } = pick(BARE);
    expect(parts(view.container).disabled).toBe(false);
  });

  it('refuses to file a skill whose invocation nobody wrote down, until one is given', () => {
    const { view } = pick(UNKNOWN);
    expect(parts(view.container).disabled).toBe(true);
    const argument = view.container.querySelector('#cb-argument-field');
    if (!(argument instanceof HTMLInputElement)) throw new Error('no argument field');
    fireEvent.change(argument, { target: { value: 'software-engineering/retrieval' } });
    expect(parts(view.container).disabled).toBe(false);
  });

  it('says the catalog is unread rather than offering an empty picker', () => {
    const { container } = render(
      <BlueprintWordsProvider value={words}>
        <RequestComposer skills={null} onFile={async () => undefined} />
      </BlueprintWordsProvider>,
    );
    expect(container.querySelector('[data-role="cb-composer"]')?.getAttribute('data-state')).toBe(
      'unread',
    );
    expect(container.querySelector('#cb-skill-field')).toBeNull();
    expect(container.textContent).toContain(W.skills_unread);
  });
});
