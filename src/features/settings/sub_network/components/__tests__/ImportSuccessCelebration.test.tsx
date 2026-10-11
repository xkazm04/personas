import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock("@/i18n/useTranslation", () => ({
  // Echo the key so assertions name the translation key, not a locale string.
  useTranslation: () => ({
    t: { sharing: new Proxy({}, { get: (_t, key) => String(key) }) },
    tx: (s: string) => s,
  }),
}));

import { ImportSuccessCelebration, importOutcome } from '../ImportSuccessCelebration';

describe('importOutcome', () => {
  it('classifies full, partial and none', () => {
    expect(importOutcome({ imported: 3, skipped: 0, errors: [] })).toBe('success');
    expect(importOutcome({ imported: 3, skipped: 0, errors: ['x'] })).toBe('partial');
    expect(importOutcome({ imported: 0, skipped: 2, errors: [] })).toBe('success');
    expect(importOutcome({ imported: 0, skipped: 2, errors: ['x'] })).toBe('failed');
  });
});

describe('ImportSuccessCelebration', () => {
  it('does not celebrate an import that imported nothing', () => {
    const { container } = render(
      <ImportSuccessCelebration importResult={{ imported: 0, skipped: 1, errors: ['templates are not importable'] }} />,
    );
    expect(screen.queryByText("import_complete")).toBeNull();
    expect(screen.getByText("import_failed")).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('uses warning tone without celebration for a partial import', () => {
    const { container } = render(
      <ImportSuccessCelebration importResult={{ imported: 2, skipped: 0, errors: ['one failed'] }} />,
    );
    expect(screen.getByText("import_partial")).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('celebrates a clean import', () => {
    const { container } = render(
      <ImportSuccessCelebration importResult={{ imported: 2, skipped: 0, errors: [] }} />,
    );
    expect(screen.getByText("import_complete")).toBeTruthy();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
