import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression pin for the stale-async defect in `ImagePreviewBlob`
 * (DriveDetailsPane.tsx): its fetch effect had NO cancellation guard at
 * all — `setUrl(current)` fired whenever `driveRead(entry.path)` resolved,
 * regardless of whether `entry.path` had since changed. Clicking through
 * files could show a previously-selected file's image.
 *
 * Fixed by extracting the guarded fetch into `loadImagePreviewUrl`, which
 * checks `isStale()` after the read resolves (and again after the object
 * URL is created) and revokes its own URL rather than handing back a stale
 * one. This pins that function directly — a full React-effect + real
 * dynamic-`import()` render was not reliably mockable in this test
 * environment (Vitest's SSR module runner served an un-mocked copy of
 * `@/api/drive` to a second same-tick dynamic import in this repo), so per
 * the "pin the extracted logic" fallback, the extraction IS the pin.
 */
import { loadImagePreviewUrl } from '../DriveDetailsPane';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('loadImagePreviewUrl — stale-path guard', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => `blob:${(b as Blob).size}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('discards a stale read: isStale() true after the read resolves', async () => {
    const read = deferred<Uint8Array>();
    let cancelled = false;
    const promise = loadImagePreviewUrl('a.png', 'image/png', () => cancelled, () => read.promise);

    // Selection moves on before the read resolves.
    cancelled = true;
    read.resolve(new Uint8Array([1, 2, 3]));

    const result = await promise;
    expect(result).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns a URL for a read that is still current when it resolves', async () => {
    const read = deferred<Uint8Array>();
    const cancelled = false;
    const promise = loadImagePreviewUrl('b.png', 'image/png', () => cancelled, () => read.promise);

    read.resolve(new Uint8Array([1, 2]));
    const result = await promise;

    expect(result).not.toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('models the actual race: an older read resolving after a newer one is discarded, the newer wins', async () => {
    const older = deferred<Uint8Array>();
    const newer = deferred<Uint8Array>();
    // The component's `cancelled` flag flips true for the OLDER effect the
    // instant the newer one mounts (React runs the older effect's cleanup
    // before the newer effect's setup) — modeled here as two independent
    // isStale closures, exactly like two overlapping effect instances.
    let olderCancelled = false;
    const newerCancelled = false;

    const olderPromise = loadImagePreviewUrl('older.png', 'image/png', () => olderCancelled, () => older.promise);
    const newerPromise = loadImagePreviewUrl('newer.png', 'image/png', () => newerCancelled, () => newer.promise);

    // Selection moves to "newer" — the older effect's cleanup fires.
    olderCancelled = true;

    // Newer resolves first (fast).
    newer.resolve(new Uint8Array([9]));
    const newerResult = await newerPromise;
    expect(newerResult).not.toBeNull();

    // The stale older read finally resolves — must be discarded, not
    // overwrite the pane with the previous file's image.
    older.resolve(new Uint8Array([1]));
    const olderResult = await olderPromise;
    expect(olderResult).toBeNull();
  });
});
