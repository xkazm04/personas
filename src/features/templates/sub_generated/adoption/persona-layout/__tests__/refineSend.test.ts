// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { sendRefine } from '../refineSend';

describe('sendRefine', () => {
  it('hands the text back when the refine reports it was not sent', async () => {
    const restore = vi.fn();
    await sendRefine('my feedback', async () => false, restore);
    expect(restore).toHaveBeenCalledWith('my feedback');
  });

  it('hands the text back when the refine throws', async () => {
    const restore = vi.fn();
    await sendRefine('my feedback', async () => { throw new Error('boom'); }, restore);
    expect(restore).toHaveBeenCalledWith('my feedback');
  });

  it('keeps the composer closed after a successful send', async () => {
    const restore = vi.fn();
    await sendRefine('ok', async () => true, restore);
    await sendRefine('ok', () => undefined, restore);
    expect(restore).not.toHaveBeenCalled();
  });
});
