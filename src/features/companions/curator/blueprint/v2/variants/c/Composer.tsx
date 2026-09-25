/**
 * The paste box - the first thing his hands touch.
 *
 * The operator files in bulk, so the primitive act is not "a field, a field and
 * a button" but "a block of links". The box takes forty lines, counts them
 * live, and the control says what it will do to that exact number. The skill
 * and the note apply to the whole batch, because he files a batch with one
 * intent; per-row correction happens afterwards, in the queue, where he can see
 * what happened.
 *
 * It arrives holding the fixture's forty links (this prototype has no clipboard
 * of his), so the first act on an empty bench is pressing File.
 */
import { useMemo, useState } from 'react';

import { KitButton, Segmented } from '@/features/shared/components/kit';

import { useWords } from '../../../words';
import { PASTED, SKILLS, type SkillName } from './fixture';

export function Composer({ onFile }: {
  onFile: (urls: readonly string[], skill: string, note: string | null) => void;
}) {
  const { w } = useWords();
  const [text, setText] = useState(PASTED);
  const [skill, setSkill] = useState<SkillName>('intake');
  const [note, setNote] = useState('');

  const urls = useMemo(
    () => text.split('\n').map((l) => l.trim()).filter(Boolean),
    [text],
  );

  return (
    <div className="cb-composer k-in">
      <label className="cb-paste">
        <span className="sr-only">{w.console.argument_required}</span>
        <textarea
          className="typo-code"
          data-testid="curator-paste"
          // i18n: one link per line; the bulk form of `argument_placeholder`.
          placeholder="one link per line"
          aria-label={w.console.argument_required}
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          rows={3}
          spellCheck={false}
        />
      </label>
      <div className="cb-composer__foot">
        <Segmented
          label={w.console.skill_label}
          value={skill}
          onChange={setSkill}
          options={SKILLS.map((s) => ({ v: s, label: s }))}
        />
        <label className="cb-note">
          <span className="sr-only">{w.console.note_label}</span>
          <input
            className="typo-body"
            type="text"
            placeholder={w.console.note_placeholder}
            aria-label={w.console.note_label}
            value={note}
            onChange={(e) => { setNote(e.target.value); }}
          />
        </label>
        <KitButton
          testId="curator-file"
          onClick={() => {
            if (!urls.length) return;
            onFile(urls, skill, note.trim() || null);
            setText('');
            setNote('');
          }}
        >
          {/* i18n: `file_request` is the singular form; the count is the whole point here. */}
          {w.console.file_request}
          <span className="typo-data k-regular cb-batch">{urls.length}</span>
        </KitButton>
      </div>
    </div>
  );
}
