import { describe, it, expect } from "vitest";
import {
  ACTIVE_PROCESS_STATUSES,
  shouldSurviveClearNonActive,
  type ActiveProcessStatus,
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
