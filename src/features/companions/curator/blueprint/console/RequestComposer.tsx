/**
 * The operator files a request against a registry skill.
 *
 * The argument field is a DIFFERENT AFFORDANCE in each of the three invocation
 * states (`skillInvocation.ts`): offered for a skill that documents running
 * bare, demanded for one that documents an argument, and demanded with a
 * reason for one whose file documents no invocation at all. The third is not
 * the second wearing a different label - `deepen` and `forge` document nothing,
 * so the composer makes the operator state the invocation rather than guessing
 * a command their file never promised.
 */
import { useCallback, useState } from 'react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { QuickDispatchSuggestions } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchSuggestions';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

import { useWords } from '../words';

import { SkillNeed } from './SkillNeed';
import { argumentNeed, argumentOf, canFile } from './skillInvocation';
import { useSkillCombobox } from './useSkillCombobox';

/** This composer's own listbox id - the `aria-controls` / option-id root. */
const LISTBOX_ID = 'curator-request-skill-listbox';

export interface ComposerProps {
  skills: CuratorSkill[] | null;
  onFile: (input: { skill: string; argument: string | null; note: string | null }) => Promise<void>;
}

export function RequestComposer({ skills, onFile }: ComposerProps) {
  const { w } = useWords();
  const combo = useSkillCombobox(skills, LISTBOX_ID);
  const [argument, setArgument] = useState('');
  const [note, setNote] = useState('');

  const selected = combo.selected;
  const need = selected ? argumentNeed(selected) : null;
  const ready = canFile(selected, argument);
  const { clear } = combo;

  const file = useCallback(async () => {
    if (!selected || !ready) return;
    await onFile({
      skill: selected.name,
      argument: argumentOf(argument),
      note: argumentOf(note),
    });
    clear();
    setArgument('');
    setNote('');
  }, [selected, ready, onFile, argument, note, clear]);

  // The catalog door did not answer. There is nothing to pick from, and the
  // composer says so rather than offering an empty picker that looks broken.
  if (!skills) {
    return (
      <div className="cb-compose" data-role="cb-composer" data-state="unread">
        <span className="cb-unset typo-caption">{w.console.skills_unread}</span>
      </div>
    );
  }

  const argumentLabel =
    need === 'optional'
      ? w.console.argument_optional
      : need === 'unknown'
        ? w.console.argument_unknown
        : w.console.argument_required;

  return (
    <div className="cb-compose typo-caption" data-role="cb-composer" data-need={need ?? 'none'}>
      <div className="cb-compose-row">
      <div className="cb-compose-skill">
        <label className="cb-clab typo-label cb-up" htmlFor="cb-skill-field">
          {w.console.skill_label}
        </label>
        <input
          id="cb-skill-field"
          className="cb-cfield"
          type="text"
          value={combo.query}
          placeholder={w.console.skill_placeholder}
          autoComplete="off"
          spellCheck={false}
          data-testid="curator-skill-field"
          onChange={(e) => {
            combo.setQuery(e.target.value);
          }}
          onKeyDown={combo.onKeyDown}
          onFocus={combo.onFocus}
          onBlur={combo.onBlur}
          {...combo.comboProps}
        />
        {combo.expanded && (
          <div className="cb-suggest">
            <QuickDispatchSuggestions
              listboxId={LISTBOX_ID}
              items={combo.suggestions}
              activeIndex={combo.activeIndex}
              onPick={combo.pick}
              onHoverIndex={combo.setActiveIndex}
            />
          </div>
        )}
      </div>

      <div className="cb-compose-arg">
        <label className="cb-clab typo-label cb-up" htmlFor="cb-argument-field">
          {argumentLabel}
        </label>
        <input
          id="cb-argument-field"
          className="cb-cfield"
          type="text"
          value={argument}
          disabled={!selected}
          // `required` follows the NEED, so the two demanding states are
          // genuinely demanding and the offered one genuinely optional.
          required={need === 'required' || need === 'unknown'}
          placeholder={selected?.argumentHint ?? w.console.argument_placeholder}
          data-testid="curator-argument-field"
          onChange={(e) => {
            setArgument(e.target.value);
          }}
        />
      </div>

      <div className="cb-compose-note">
        <label className="cb-clab typo-label cb-up" htmlFor="cb-note-field">
          {w.console.note_label}
        </label>
        <input
          id="cb-note-field"
          className="cb-cfield"
          type="text"
          value={note}
          disabled={!selected}
          placeholder={w.console.note_placeholder}
          data-testid="curator-note-field"
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </div>

      <AsyncButton
        variant="primary"
        size="sm"
        className="cb-keep"
        disabled={!ready}
        data-testid="curator-file-request"
        onClick={file}
      >
        {w.console.file_request}
      </AsyncButton>
      </div>

      {/* The picked skill's lane and what it needs, on a line of its own that
          is ALWAYS reserved. The unknown badge is a sentence, not a word, and
          it needs the width; a line that appeared only once a skill was picked
          would also move the whole ledger below it on every pick. */}
      <div className="cb-need-line" data-role="cb-skill-line">
        {selected && (
          <>
            <i className="cb-lane-tag">{w.console.lane_tag[selected.lane]}</i>
            <SkillNeed skill={selected} />
          </>
        )}
      </div>
    </div>
  );
}
