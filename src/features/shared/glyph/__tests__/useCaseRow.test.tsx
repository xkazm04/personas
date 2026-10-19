import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UseCaseRow } from '../persona-layout/UseCaseRow';
import type { PersonaCapability } from '@/lib/personas/capabilities';

/**
 * `--primary` and `--foreground` are HEX tokens (globals.css), so the row's
 * old inline colours - `rgb(var(--primary))2e` for the hover ring and
 * `rgb(var(--foreground) / 0.55)` for the title - were invalid at computed-
 * value time and the browser dropped both declarations: no hover ring on an
 * active row and no dimming on a disabled one. jsdom's style parser rejects
 * the same strings, so reading `style` back is the check.
 */
const uc = (overrides: Partial<PersonaCapability> = {}): PersonaCapability => ({
  id: 'uc-1',
  title: 'Draft the weekly digest',
  description: '',
  mode: 'e2e',
  health: 'active',
  hasModelOverride: false,
  notificationChannels: [],
  triggerLabel: '',
  connector: '',
  connectorKey: null,
  dimensions: ['trigger', 'task'],
  // Invariant justifying the one cast in this fixture: UseCaseRow reads
  // display fields only; `raw` feeds policy controls it does not render.
  origin: 'design-use-case',
  raw: {} as PersonaCapability['raw'],
  ...overrides,
});

const noop = () => {};

describe('UseCaseRow colours', () => {
  it('paints a hover ring on an active row', () => {
    render(<UseCaseRow uc={uc()} isPendingToggle={false} onOpen={noop} onToggle={noop} />);
    const row = screen.getByTestId('uc-row-uc-1');
    fireEvent.mouseEnter(row);
    // jsdom accepts any value holding var() at parse time (as browsers do),
    // so the active branch is checked by shape: a hex token goes through
    // color-mix, never through rgb().
    expect(row.style.boxShadow).toContain('color-mix(in srgb, var(--primary)');
    expect(row.style.boxShadow).not.toContain('rgb(var(');
  });

  it('paints a hover ring on a disabled row', () => {
    render(
      <UseCaseRow uc={uc({ health: 'disabled' })} isPendingToggle={false} onOpen={noop} onToggle={noop} />,
    );
    const row = screen.getByTestId('uc-row-uc-1');
    fireEvent.mouseEnter(row);
    expect(row.style.boxShadow).toContain('inset');
  });

  it('dims the title of a disabled row and not of an active one', () => {
    const { unmount } = render(
      <UseCaseRow uc={uc({ health: 'disabled' })} isPendingToggle={false} onOpen={noop} onToggle={noop} />,
    );
    const dimmed = screen.getByText('Draft the weekly digest');
    expect(dimmed.className).toContain('text-muted-foreground');
    unmount();
    render(<UseCaseRow uc={uc()} isPendingToggle={false} onOpen={noop} onToggle={noop} />);
    expect(screen.getByText('Draft the weekly digest').className).toContain('text-foreground');
    expect(screen.getByText('Draft the weekly digest').className).not.toContain('text-muted-foreground');
  });
});
