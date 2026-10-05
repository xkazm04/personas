import { describe, it, expect } from "vitest";
import { create } from "zustand";
import {
  ACTIVE_PROCESS_STATUSES,
  createProcessActivitySlice,
  shouldSurviveClearNonActive,
  type ActiveProcessStatus,
  type ProcessActivitySlice,
} from "./processActivitySlice";

describe("processActivitySlice.clearNonActive semantics", () => {
  it("keeps only 'running' — every other enum value is dropped", () => {
    // If someone adds a new ActiveProcessStatus, the switch inside
    // shouldSurviveClearNonActive fails exhaustiveness and this test
    // compiles-with-an-error before it ever runs. Together the pair force
    // an explicit decision at review time.
    for (const status of ACTIVE_PROCESS_STATUSES) {
      const survives = shouldSurviveClearNonActive(status);
      if (status === "running") {
        expect(survives, `"running" must survive clearNonActive`).toBe(true);
      } else {
        expect(survives, `"${status}" must NOT survive clearNonActive`).toBe(false);
      }
    }
  });

  it("enum does not contain the legacy 'action_required' label", () => {
    // Historical: this status was renamed to 'input_required'. This assertion
    // catches a revert that reintroduces the old name out-of-sync with the
    // i18n status_tokens registry.
    const names: readonly string[] = ACTIVE_PROCESS_STATUSES;
    expect(names).not.toContain("action_required" as ActiveProcessStatus);
    expect(names).toContain("input_required" as ActiveProcessStatus);
  });
});

describe("processActivitySlice — the owning persona id survives the run's lifecycle", () => {
  const mkStore = () => create<ProcessActivitySlice>()(createProcessActivitySlice);

  it("keeps personaId when a queued run starts without one", () => {
    const store = mkStore();
    // QUEUE_STATUS carries the id; the runner's later "started" event may not.
    store.getState().processQueued("execution", "r1", undefined, 1, "persona-a");
    store.getState().processStarted("execution", "r1", "Echo");
    const proc = store.getState().activeProcesses["execution:r1"]!;
    expect(proc.status).toBe("running");
    expect(proc.personaId).toBe("persona-a");
    expect(proc.label).toBe("Echo");
  });

  it("keeps personaId when the second queued producer omits it", () => {
    const store = mkStore();
    store.getState().processQueued("execution", "r1", undefined, 2, "persona-a");
    store.getState().processQueued("execution", "r1", "Echo");
    expect(store.getState().activeProcesses["execution:r1"]!.personaId).toBe("persona-a");
    expect(store.getState().activeProcessCount).toBe(1);
  });

  it("keeps personaId through a promotion", () => {
    const store = mkStore();
    store.getState().processQueued("execution", "r1", undefined, 1, "persona-a");
    store.getState().processPromoted("r1");
    const proc = store.getState().activeProcesses["execution:r1"]!;
    expect(proc.status).toBe("running");
    expect(proc.personaId).toBe("persona-a");
  });

  it("records the id a started event carries", () => {
    const store = mkStore();
    store.getState().processStarted("execution", "r2", "Echo", undefined, "persona-b");
    expect(store.getState().activeProcesses["execution:r2"]!.personaId).toBe("persona-b");
  });
});
