import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The restore confirmation used to say the overwrite "cannot be undone". Since
// the backend snapshots the live tree as a "before restore" version first, that
// was false: the user was warned off an action they could take back. These
// cases pin both halves: what the dialog says, and the backend behaviour that
// makes it true.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => String(k) }) }),
    tx: (s: string) => s,
  }),
}));
vi.mock('@/api/webbuild', () => ({
  webbuildListVersions: vi.fn(async () => [
    { sha: 'abc1234', message: 'athena: Built the menu', when: '2 minutes ago' },
  ]),
  webbuildRestoreVersion: vi.fn(async () => undefined),
}));

const StudioVersions = (await import('../StudioVersions')).default;

afterEach(cleanup);

describe('version restore confirmation', () => {
  it('names the version and does not claim the restore is permanent', async () => {
    render(<StudioVersions id="p1" onRestored={() => {}} />);
    fireEvent.click(screen.getByTestId('studio-versions'));
    fireEvent.click(await screen.findByRole('menuitem'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Built the menu');
    expect(dialog.textContent).not.toContain('confirm_destructive_cannot_undo');
  });

  it('is true because the backend captures the live tree before it restores', () => {
    const src = readFileSync(resolve(process.cwd(), 'src-tauri/src/webbuild/versions.rs'), 'utf8')
      .replace(/\/\/.*$/gm, '');
    const body = src.slice(src.indexOf('pub async fn restore('));
    const capture = body.indexOf('commit_snapshot(project_dir, "before restore").await?');
    const overwrite = body.indexOf('"restore"');
    expect(capture).toBeGreaterThan(-1);
    expect(overwrite).toBeGreaterThan(capture);
  });
});
