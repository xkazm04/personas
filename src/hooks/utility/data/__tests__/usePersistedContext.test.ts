import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePersistedContext } from "../usePersistedContext";

const KEY = "test:persisted-context";
const MAX_AGE = 60_000;

interface Ctx { jobId?: string; savedAt?: number }

function setup(overrides: Partial<Parameters<typeof usePersistedContext<Ctx>>[0]> = {}) {
  const onRestore = vi.fn();
  const utils = renderHook(
    (props: { enabled: boolean }) =>
      usePersistedContext<Ctx>({
        key: KEY,
        maxAge: MAX_AGE,
        enabled: props.enabled,
        validate: (p) => p.jobId ?? null,
        getSavedAt: (p) => p.savedAt,
        onRestore,
        ...overrides,
      }),
    { initialProps: { enabled: true } },
  );
  return { onRestore, ...utils };
}

describe("usePersistedContext", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("restores a valid, fresh context on mount", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ jobId: "j-1", savedAt: Date.now() }));
    const { onRestore } = setup();
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0][0]).toMatchObject({ jobId: "j-1" });
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("does nothing when there is no stored entry", () => {
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("discards and removes an entry `validate` rejects", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now() }));
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("discards and removes an entry older than maxAge", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ jobId: "j-1", savedAt: Date.now() - MAX_AGE - 1 }),
    );
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a context with no savedAt (fail closed — age unprovable)", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ jobId: "j-1" }));
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a context whose savedAt is not a finite number", () => {
    // `Infinity` round-trips through JSON as `null`; a string timestamp is the
    // other shape a legacy/hand-edited entry can carry.
    window.localStorage.setItem(KEY, JSON.stringify({ jobId: "j-1", savedAt: "yesterday" }));
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a non-object entry instead of asserting it to T", () => {
    window.localStorage.setItem(KEY, JSON.stringify("just-a-string"));
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("removes a corrupt entry instead of throwing", () => {
    window.localStorage.setItem(KEY, "{ not json");
    const { onRestore } = setup();
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("does not restore while disabled, and restores once enabled flips true", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ jobId: "j-1", savedAt: Date.now() }));
    const onRestore = vi.fn();
    const { rerender } = renderHook(
      (props: { enabled: boolean }) =>
        usePersistedContext<Ctx>({
          key: KEY,
          maxAge: MAX_AGE,
          enabled: props.enabled,
          validate: (p) => p.jobId ?? null,
          getSavedAt: (p) => p.savedAt,
          onRestore,
        }),
      { initialProps: { enabled: false } },
    );
    expect(onRestore).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(onRestore).toHaveBeenCalledTimes(1);

    // The guard is one-shot per lifecycle: further renders must not re-restore.
    rerender({ enabled: true });
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
