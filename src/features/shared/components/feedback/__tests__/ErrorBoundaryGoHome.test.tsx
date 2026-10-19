import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

vi.mock('@/lib/utils/crashPersistence', () => ({ persistCrash: vi.fn() }));

function Boom(): never {
  throw new Error('boom');
}

const goHomeButton = () => screen.queryByRole('button', { name: /dashboard/i });

describe('ErrorBoundary "Go to dashboard"', () => {
  it('is not offered when the host cannot navigate (it would only re-render the crash)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary key="section" name="Section">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(goHomeButton()).toBeNull();
  });

  it('navigates through the host when one is wired', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onGoHome = vi.fn();
    render(
      <ErrorBoundary name="Section" onGoHome={onGoHome}>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(goHomeButton()!);
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });
});
