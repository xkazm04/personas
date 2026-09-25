import { describe, it, expect } from 'vitest';
import { descriptionAfterTitle } from '../backlogColumns';

describe('descriptionAfterTitle', () => {
  it('drops a repeated title and the separator after it', () => {
    expect(descriptionAfterTitle('Fix the pager. It sits far below the rows.', 'Fix the pager')).toBe('It sits far below the rows.');
    expect(descriptionAfterTitle('fix the pager: it floats', 'Fix the pager')).toBe('it floats');
  });
  it('returns nothing when the description is only the title', () => {
    expect(descriptionAfterTitle('Fix the pager.', 'Fix the pager')).toBe('');
  });
  it('keeps a description that does not start with the title', () => {
    expect(descriptionAfterTitle('The pager floats.', 'Fix the pager')).toBe('The pager floats.');
  });
});
