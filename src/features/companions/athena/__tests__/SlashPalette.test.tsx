import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  SlashPalette,
  filterSlashPresets,
  type SlashPreset,
} from '../SlashPalette';

const presets: SlashPreset[] = [
  { key: 'goals', label: 'Show goals', message: 'Show me my goals.' },
  { key: 'queued', label: "What's queued", message: 'What jobs are queued?' },
  {
    key: 'decisions',
    label: 'Recent decisions',
    message: 'Read decisions back.',
  },
  { key: 'live_ops', label: 'Live ops', message: 'What is running now?' },
];

describe('filterSlashPresets', () => {
  it('returns the full list when query is empty', () => {
    expect(filterSlashPresets(presets, '')).toEqual(presets);
  });

  it('filters by case-insensitive label substring', () => {
    expect(filterSlashPresets(presets, 'queued')).toEqual([presets[1]]);
    expect(filterSlashPresets(presets, 'LIVE')).toEqual([presets[3]]);
  });

  it('filters by key substring as well as label', () => {
    expect(filterSlashPresets(presets, 'live_ops')).toEqual([presets[3]]);
  });

  it('returns empty for a query that matches nothing', () => {
    expect(filterSlashPresets(presets, 'no-match-token')).toEqual([]);
  });
});

describe('SlashPalette', () => {
  it('renders all items when query is empty', () => {
    render(
      <SlashPalette
        query=""
        selectedIndex={0}
        presets={presets}
        onSelect={() => {}}
        onHoverIndex={() => {}}
      />,
    );
    expect(screen.getAllByTestId('companion-slash-item')).toHaveLength(4);
  });

  it('marks the active row via data-active', () => {
    render(
      <SlashPalette
        query=""
        selectedIndex={2}
        presets={presets}
        onSelect={() => {}}
        onHoverIndex={() => {}}
      />,
    );
    const items = screen.getAllByTestId('companion-slash-item');
    expect(items[0]?.getAttribute('data-active')).toBe('false');
    expect(items[2]?.getAttribute('data-active')).toBe('true');
  });

  it('fires onSelect with the picked preset when clicked', () => {
    const onSelect = vi.fn();
    render(
      <SlashPalette
        query=""
        selectedIndex={0}
        presets={presets}
        onSelect={onSelect}
        onHoverIndex={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByTestId('companion-slash-item')[1]!);
    expect(onSelect).toHaveBeenCalledWith(presets[1]);
  });

  it('updates hover index when the mouse enters a row', () => {
    const onHover = vi.fn();
    render(
      <SlashPalette
        query=""
        selectedIndex={0}
        presets={presets}
        onSelect={() => {}}
        onHoverIndex={onHover}
      />,
    );
    fireEvent.mouseEnter(screen.getAllByTestId('companion-slash-item')[2]!);
    expect(onHover).toHaveBeenCalledWith(2);
  });

  it('renders the empty-state message when filtered list is empty', () => {
    render(
      <SlashPalette
        query=""
        selectedIndex={0}
        presets={[]}
        onSelect={() => {}}
        onHoverIndex={() => {}}
      />,
    );
    expect(screen.queryByTestId('companion-slash-item')).toBeNull();
    expect(screen.getByTestId('companion-slash-palette')).toBeInTheDocument();
  });

  it('clamps the selectedIndex visually if it overshoots the filtered list', () => {
    render(
      <SlashPalette
        query=""
        selectedIndex={99}
        presets={presets}
        onSelect={() => {}}
        onHoverIndex={() => {}}
      />,
    );
    const items = screen.getAllByTestId('companion-slash-item');
    // None should claim active=true beyond the last index; only the last
    // item gets clamped-to-active.
    expect(items.at(-1)?.getAttribute('data-active')).toBe('true');
  });
});
