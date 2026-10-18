/**
 * PersonaAvatar agrees with its sibling PersonaIcon on two failure paths.
 *
 * 1. A broken image source (dead remote URL, missing asset) must fall through
 *    to the initial/Bot fallback. PersonaIcon tracks the failed src; the avatar
 *    had no onError at all and painted the browser's broken-image frame.
 * 2. The initial fallback tinted its background by appending a hex alpha to
 *    the colour string (`${color}20`). For a 3-digit hex (`#abc`) that is
 *    `#abc20`, invalid CSS the browser drops, so the tile lost its tint. The
 *    Bot branch of the same component already used colorWithAlpha.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PersonaAvatar } from '../PersonaAvatar';

describe('PersonaAvatar', () => {
  it('falls back to the initial when the image fails to load', () => {
    const { container } = render(
      <PersonaAvatar icon="https://example.invalid/dead.png" name="Weather Bot" color="#3366ff" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('tints the initial tile for a 3-digit hex colour', () => {
    render(<PersonaAvatar icon={null} name="Weather Bot" color="#abc" />);
    const tile = screen.getByText('W');
    expect(tile.style.backgroundColor).not.toBe('');
    expect(tile.style.borderColor).not.toBe('');
  });
});
