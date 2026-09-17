/**
 * The combobox wiring, which is the half of the suggestion feature a unit test
 * on the ranking cannot see: a correctly ranked list that a screen reader never
 * hears about is not a feature.
 *
 * The ARIA claims under test are exactly the ones that can DANGLE — an
 * `aria-controls` pointing at no element and an `aria-activedescendant` pointing
 * at no option are both invisible on screen and both make the control silent.
 * They are resolved with `getElementById` rather than asserted as strings.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import AddressBar from '../webview/AddressBar';
import type { BrowserSite, BrowserTab } from '../types';

function site(origin: string, label = '', enabled = true): BrowserSite {
  return {
    origin,
    label,
    enabled,
    overrides: {},
    budget: 50,
    credential_id: null,
    scan_status: 'none',
    scan_tier: null,
    scan_report: null,
    scan_at: null,
    first_seen: 0,
    last_seen: 0,
    created_by: 'operator',
  };
}

const TAB: BrowserTab = {
  id: 1,
  url: 'https://app.example.com',
  title: 'App',
  origin: 'https://app.example.com',
  focused: true,
  lease: null,
  can_go_back: false,
  can_go_forward: false,
};

const SITES = [
  site('https://app.example.com', 'App'),
  site('https://paused.example.com', 'Paused', false),
  site('http://localhost:*', 'Local dev (example)'),
];

/**
 * The field is CONTROLLED, so a test that fires `change` at a component whose
 * `value` prop never moves is testing nothing: React drops the event when the
 * value it would set is the value already there. The harness owns the state the
 * route owns in production.
 */
function Harness(props: Omit<Parameters<typeof AddressBar>[0], 'value' | 'onChange'> & {
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <AddressBar
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

function baseProps() {
  return {
    tab: TAB,
    refusal: null,
    sites: SITES,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onSelectSuggestion: vi.fn(),
    onSuggestionsOpenChange: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
  };
}

function setup(query: string) {
  const props = baseProps();
  const view = render(<Harness {...props} />);
  const input = screen.getByTestId('webview-address');
  fireEvent.change(input, { target: { value: query } });
  return { ...props, input, view };
}

describe('AddressBar combobox', () => {
  it('is a closed combobox until something is typed', () => {
    const props = { ...baseProps(), value: 'https://app.example.com', onChange: vi.fn() };
    render(<AddressBar {...props} />);
    const input = screen.getByTestId('webview-address');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('webview-suggestions')).toBeNull();
    expect(props.onSuggestionsOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('opens on typing and points aria-controls at a listbox that exists', () => {
    const { input, onSuggestionsOpenChange } = setup('example');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const controls = input.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const listbox = document.getElementById(controls as string);
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute('role')).toBe('listbox');
    expect(listbox).toBe(screen.getByTestId('webview-suggestions'));
    expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('points aria-activedescendant at a real option once the arrow keys move', () => {
    const { input } = setup('example');
    expect(input.getAttribute('aria-activedescendant')).toBe(null);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const option = document.getElementById(active as string);
    expect(option).not.toBeNull();
    expect(option?.getAttribute('role')).toBe('option');
    expect(option?.getAttribute('aria-selected')).toBe('true');
    expect(option).toBe(screen.getByTestId('webview-suggestion-0'));
  });

  it('never lands the cursor on a paused row, and Enter takes the enabled one', () => {
    const { input, onSelectSuggestion, onSubmit } = setup('example.com');
    // Two rows match; the paused one is last and is marked as such.
    expect(screen.getByTestId('webview-suggestion-1').getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Wrapped past the paused row and back onto the only selectable one.
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByTestId('webview-suggestion-0').id,
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectSuggestion).toHaveBeenCalledWith('https://app.example.com');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('expands a pattern row to the port that was typed', () => {
    const { input, onSelectSuggestion } = setup('localhost:3000');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectSuggestion).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('lets Enter navigate to the typed text when no line is pointed at', () => {
    const { input, onSubmit, onSelectSuggestion } = setup('example');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSelectSuggestion).not.toHaveBeenCalled();
  });

  it('closes on Escape and tells the route the page host may come back', () => {
    const { input, onSuggestionsOpenChange } = setup('example');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('webview-suggestions')).toBeNull();
    expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('carries one dead line, not an empty popup, when nothing matches', () => {
    const { input } = setup('zzzznotasite');
    expect(screen.getByTestId('webview-suggestions')).toBeTruthy();
    const dead = screen.getByTestId('webview-suggestion-none');
    expect(dead.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('webview-suggestion-0')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-activedescendant')).toBe(null);
  });

  it('hides the page host again when it unmounts with the popup open', () => {
    const { onSuggestionsOpenChange, view } = setup('example');
    onSuggestionsOpenChange.mockClear();
    view.unmount();
    expect(onSuggestionsOpenChange).toHaveBeenCalledWith(false);
  });
});
