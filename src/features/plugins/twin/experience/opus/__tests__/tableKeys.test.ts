import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { tableKeyHandler } from '../table/tableKeys';
import { channelName } from '../suits';

function keyEvent(key: string, target: Partial<HTMLElement> = { tagName: 'DIV' }, mods: Partial<KeyboardEvent> = {}) {
  const preventDefault = vi.fn();
  const event = {
    key,
    target: { getAttribute: () => null, isContentEditable: false, ...target },
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault,
    ...mods,
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
}

function setup(picked = 0, count = 3) {
  const calls = { setPicked: vi.fn(), play: vi.fn(), edit: vi.fn(), skip: vi.fn() };
  const handler = tableKeyHandler({ count, picked, ...calls });
  return { handler, ...calls };
}

describe('the table keys', () => {
  it('digits pick, arrows move within the hand, Enter plays, E edits, S skips', () => {
    const t = setup(1);
    t.handler(keyEvent('3').event);
    expect(t.setPicked).toHaveBeenLastCalledWith(2);
    t.handler(keyEvent('ArrowRight').event);
    expect(t.setPicked).toHaveBeenLastCalledWith(2);
    t.handler(keyEvent('ArrowLeft').event);
    expect(t.setPicked).toHaveBeenLastCalledWith(0);
    t.handler(keyEvent('Enter').event);
    expect(t.play).toHaveBeenCalledWith(1);
    t.handler(keyEvent('e').event);
    expect(t.edit).toHaveBeenCalledWith(1);
    t.handler(keyEvent('S').event);
    expect(t.skip).toHaveBeenCalledTimes(1);
  });

  it('a digit past the hand does nothing', () => {
    const t = setup(0, 2);
    const { event, preventDefault } = keyEvent('3');
    t.handler(event);
    expect(t.setPicked).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('the composer takes every letter, including E and S', () => {
    const t = setup();
    t.handler(keyEvent('s', { tagName: 'TEXTAREA' }).event);
    t.handler(keyEvent('e', { tagName: 'INPUT' }).event);
    t.handler(keyEvent('1', { tagName: 'TEXTAREA' }).event);
    expect(t.skip).not.toHaveBeenCalled();
    expect(t.edit).not.toHaveBeenCalled();
    expect(t.setPicked).not.toHaveBeenCalled();
  });

  it('Enter on a button presses the button, not a card as well', () => {
    const t = setup();
    t.handler(keyEvent('Enter', { tagName: 'BUTTON' }).event);
    expect(t.play).not.toHaveBeenCalled();
  });

  it('modifier chords pass through: Ctrl+S is not a skip', () => {
    const t = setup();
    const { event, preventDefault } = keyEvent('s', { tagName: 'DIV' }, { ctrlKey: true });
    t.handler(event);
    expect(t.skip).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('with no cards, Enter and E do nothing and S still skips', () => {
    const t = setup(0, 0);
    t.handler(keyEvent('Enter').event);
    t.handler(keyEvent('e').event);
    t.handler(keyEvent('s').event);
    expect(t.play).not.toHaveBeenCalled();
    expect(t.edit).not.toHaveBeenCalled();
    expect(t.skip).toHaveBeenCalledTimes(1);
  });
});

describe('channel names', () => {
  it('shows the generic register as everywhere and a channel type as its product writes it', () => {
    expect(channelName('generic', 'Everywhere')).toBe('Everywhere');
    expect(channelName('slack', 'Everywhere')).toBe('Slack');
    expect(channelName('email', 'Everywhere')).toBe('Email');
  });
});
