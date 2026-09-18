import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { SelectPills } from '../SelectPills';

const OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const CUSTOM_LABEL = en.templates.adopt_modal.custom_plain;
const CUSTOM_PREFIX = en.templates.adopt_modal.custom_prefix;

describe('SelectPills allowCustom default', () => {
  it('omits the Other pill when the question does not author allow_custom', () => {
    // The grid passes `question.allow_custom`, undefined on most questions.
    render(<SelectPills options={OPTIONS} value="" onChange={vi.fn()} allowCustom={undefined} />);

    expect(screen.queryByText(CUSTOM_LABEL)).toBeNull();
    expect(screen.getByText('Daily')).toBeTruthy();
  });

  it('ignores an off-list value instead of rendering it as a custom pill', () => {
    render(<SelectPills options={OPTIONS} value="asdf" onChange={vi.fn()} />);

    expect(screen.queryByText('asdf')).toBeNull();
    expect(screen.queryByText(CUSTOM_LABEL)).toBeNull();
  });

  it('ignores off-list values in multi-select too', () => {
    render(<SelectPills options={OPTIONS} value="daily,asdf" onChange={vi.fn()} multi />);

    expect(screen.queryByText('asdf')).toBeNull();
    expect(screen.queryByText(CUSTOM_PREFIX)).toBeNull();
  });

  it('still offers the escape hatch when the template authors allow_custom', () => {
    render(<SelectPills options={OPTIONS} value="" onChange={vi.fn()} allowCustom />);

    const other = screen.getByText(CUSTOM_LABEL);
    fireEvent.click(other);
    expect(screen.getByPlaceholderText(en.templates.adopt_modal.type_custom_value)).toBeTruthy();
  });

  it('keeps authored off-list values visible when allow_custom is on', () => {
    render(<SelectPills options={OPTIONS} value="asdf" onChange={vi.fn()} allowCustom />);
    expect(screen.getByText('asdf')).toBeTruthy();
  });
});
