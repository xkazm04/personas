import { describe, it, expect, beforeEach, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { mockInvoke, resetInvokeMocks } from "@/test/tauriMock";
import { labImprovePrompt } from "@/api/agents/lab";

const mockedInvoke = vi.mocked(invoke);

describe("api/agents/lab — labImprovePrompt idempotency", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("passes the caller's idempotency key through to the backend payload", async () => {
    mockInvoke("lab_improve_prompt", { id: "v-1", version_number: 2 });
    await labImprovePrompt("p-1", "run-1", "arena", "gesture-key");
    expect(mockedInvoke).toHaveBeenCalledWith(
      "lab_improve_prompt",
      expect.objectContaining({
        personaId: "p-1",
        runId: "run-1",
        mode: "arena",
        idempotencyKey: "gesture-key",
      }),
      expect.anything(),
    );
  });

  it("retrying the same gesture sends the SAME key — the backend can dedup it", async () => {
    mockInvoke("lab_improve_prompt", { id: "v-1", version_number: 2 });
    await labImprovePrompt("p-1", "run-1", "arena", "gesture-key");
    await labImprovePrompt("p-1", "run-1", "arena", "gesture-key");
    const keys = mockedInvoke.mock.calls.map(
      (c) => (c[1] as { idempotencyKey?: string }).idempotencyKey,
    );
    expect(keys).toEqual(["gesture-key", "gesture-key"]);
  });

  it("defaults a key when the caller supplies none, so a call is never unkeyed", async () => {
    mockInvoke("lab_improve_prompt", { id: "v-1", version_number: 2 });
    await labImprovePrompt("p-1", "run-1", "arena");
    const payload = mockedInvoke.mock.calls[0][1] as { idempotencyKey?: string };
    expect(payload.idempotencyKey).toEqual(expect.any(String));
    expect(payload.idempotencyKey).not.toEqual("");
  });
});
