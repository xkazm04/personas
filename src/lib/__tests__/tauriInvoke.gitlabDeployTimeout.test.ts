import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Test-only: the mocked raw `invoke` stands in for a slow backend.
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { invokeWithTimeout, _clearAutoDedupForTests } from "../tauriInvoke";

(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

// Backend budget: up to ~9 sequential 30 s HTTP legs (~270 s). The 90 s IPC
// default rejected while the deploy kept running, and a retry created a
// second (non-idempotent) Duo agent.
describe.each(["gitlab_deploy_persona", "gitlab_deploy_persona_versioned"] as const)(
  "%s IPC timeout",
  (command) => {
    beforeEach(() => {
      vi.useFakeTimers();
      _clearAutoDedupForTests();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps waiting past the 90 s default and past the ~270 s backend worst case", async () => {
      let finish: (v: unknown) => void = () => {};
      vi.mocked(invoke).mockReturnValue(new Promise((r) => (finish = r)));
      let settled = "pending";
      const p = invokeWithTimeout(command, { personaId: "p", projectId: 1 }).then(
        () => (settled = "ok"),
        () => (settled = "rejected"),
      );
      await vi.advanceTimersByTimeAsync(300_000);
      expect(settled).toBe("pending");
      finish({ ok: true });
      await p;
      expect(settled).toBe("ok");
    });
  },
);
