import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  resolve(__dirname, '../SettingsStatusBar.tsx'),
  'utf8',
);

describe('SettingsStatusBar chrome', () => {
  it('uses no raw <button> elements', () => {
    expect(src.match(/<button\b/g) ?? []).toHaveLength(0);
  });
  it('uses no raw palette colour classes', () => {
    expect(src.match(/\b(?:red|amber|emerald)-\d{2,3}\b/g) ?? []).toHaveLength(0);
  });
});
