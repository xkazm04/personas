/**
 * An `in` condition authored in the rule form must reach Rust as a JSON array.
 *
 * `compare_string` (triage.rs) evaluates `in` with `value.as_array()`, and the
 * form used to send the typed text as ONE string, so every `in` rule the
 * operator saved matched no idea, silently. The evaluator's shape is read from
 * the Rust source so the two sides cannot drift apart unseen.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';

const createTriageRule = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ createTriageRule }),
}));

import { TriageRuleForm, conditionValue } from '../TriageRuleForm';

describe('TriageRuleForm - the `in` operator', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['common', 'plugins']);
  });
  beforeEach(() => {
    createTriageRule.mockReset().mockResolvedValue(undefined);
  });

  it('the Rust evaluator matches `in` only against an array', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src-tauri/src/commands/infrastructure/dev_tools/triage.rs'),
      'utf8',
    ).replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/"in"\s*=>\s*value\s*\.and_then\(\|v\|\s*v\.as_array\(\)\)/);
  });

  it('splits the typed list into an array, trimmed and without blanks', () => {
    expect(conditionValue({ field: 'category', op: 'in', value: 'ui, performance,, ' })).toEqual(['ui', 'performance']);
    expect(conditionValue({ field: 'category', op: 'eq', value: 'ui' })).toBe('ui');
    expect(conditionValue({ field: 'effort', op: 'lt', value: '4' })).toBe(4);
  });

  it('saves an `in` rule whose value is an array', async () => {
    const onClose = vi.fn();
    const { container } = render(<TriageRuleForm projectId="p1" onClose={onClose} />);

    const [nameInput] = container.querySelectorAll('input[type="text"]');
    fireEvent.change(nameInput!, { target: { value: 'Drop docs noise' } });
    const [fieldSelect, opSelect] = container.querySelectorAll('select');
    fireEvent.change(fieldSelect!, { target: { value: 'category' } });
    fireEvent.change(opSelect!, { target: { value: 'in' } });
    const valueInput = container.querySelectorAll('input[type="text"]')[1];
    fireEvent.change(valueInput!, { target: { value: 'documentation, ui' } });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(createTriageRule).toHaveBeenCalledTimes(1));
    const [name, conditionsJson, action, projectId] = createTriageRule.mock.calls[0]!;
    expect(name).toBe('Drop docs noise');
    expect(JSON.parse(conditionsJson as string)).toEqual([
      { field: 'category', op: 'in', value: ['documentation', 'ui'] },
    ]);
    expect(action).toBe('accept');
    expect(projectId).toBe('p1');
  });
});
