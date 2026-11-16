import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: (_o, s) => new Proxy({}, { get: (_s, k) => `${String(s)}.${String(k)}` }) }),
  }),
}));
vi.mock('@/lib/ui/BaseModal', () => ({
  BaseModal: ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) =>
    isOpen ? (
      <div>
        <div data-testid="backdrop" onClick={onClose} />
        {children}
      </div>
    ) : null,
}));

import { RowActionMenu } from '../RowActionMenu';

describe('RowActionMenu', () => {
  it('a backdrop click closes the menu without activating the row behind it', () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <RowActionMenu reviewId="r1" onDelete={() => {}} onViewDetails={() => {}} onRebuild={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(rowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(screen.queryByTestId('backdrop')).toBeNull();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
