import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './lazyRetry';

describe('isChunkLoadError', () => {
  it('matches the Chromium/WebView2 dynamic-import failure', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: http://localhost:1420/src/features/teams/sub_teamWorkspace/TeamCanvas.tsx',
        ),
      ),
    ).toBe(true);
  });

  it('matches the WebKit module-script failure', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  });

  it('matches the Firefox dynamic-import failure', () => {
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: x'))).toBe(true);
  });

  it('rejects ordinary render errors', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error('Maximum update depth exceeded'))).toBe(false);
  });

  it('tolerates non-Error inputs', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: x')).toBe(true);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});
