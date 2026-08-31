import { describe, it, expect, vi, beforeEach } from "vitest";
// Test-only: need the mocked raw `invoke` to assert round-trip counts;
// production code must still go through invokeWithTimeout.
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import type { CommandName } from "../tauriInvoke";
import { invokeWithTimeout, isDedupEligible, _clearAutoDedupForTests } from "../tauriInvoke";

// The global mock in src/test/setup.ts already mocks @tauri-apps/api/core's
// `invoke` to resolve `undefined`; avoid the ~2s IPC-token poll in
// `waitForIpcToken` the same way src/features/plugins/drive/hooks/__tests__/useDrive.test.ts does.
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

// Test-only cast: exercising the dedup-eligibility logic on fabricated
// command strings, not real backend commands — `isDedupEligible` operates on
// the raw string shape and does not need a registered CommandName.
const cmd = (s: string) => s as unknown as CommandName;

describe("isDedupEligible", () => {
  it.each([
    // --- prefix names (pre-existing contract) ---
    ["list_personas", true],
    ["get_app_setting", true],
    ["fetch_somafm_metadata", true],
    // --- infix names (the new coverage) ---
    ["dev_tools_list_kpis", true],
    ["companion_get_x", true],
    ["radio_fetch_somafm_metadata", true],
    ["gitlab_list_projects", true],
    // --- mutation-verb traps: a read verb is present but must not win ---
    ["get_or_create_session", false],
    ["dev_tools_update_kpi", false],
    ["fetch_and_apply", false],
    ["create_persona", false],
    ["delete_credential", false],
    ["dev_tools_run_now", false],
    ["execute_persona", false],
    ["toggle_feature", false],
    ["system_ops_run_now", false],
    // --- substring trap: a mutation VERB WORD embedded in a longer noun
    // segment must NOT trigger exclusion (segment-exact match only) ---
    ["list_settings", true],
    // --- no read verb at all ---
    ["not_a_read_command", false],
    ["abort_team_assignment", false],
  ] as const)("isDedupEligible(%s) === %s", (name, expected) => {
    expect(isDedupEligible(name)).toBe(expected);
  });
});

describe("invokeWithTimeout auto-dedup with the infix-aware eligibility rule", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    _clearAutoDedupForTests();
  });

  it("folds concurrent identical calls to an INFIX-named read command into one round-trip", async () => {
    const p1 = invokeWithTimeout(cmd("dev_tools_list_kpis"), { projectId: "p1" });
    const p2 = invokeWithTimeout(cmd("dev_tools_list_kpis"), { projectId: "p1" });
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does NOT fold concurrent identical calls to a mutation-verb-trap command, even though it also matches a read verb", async () => {
    const p1 = invokeWithTimeout(cmd("dev_tools_update_kpi"), { id: "k1" });
    const p2 = invokeWithTimeout(cmd("dev_tools_update_kpi"), { id: "k1" });
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does NOT fold get_or_create_session even though it starts with get_", async () => {
    const p1 = invokeWithTimeout(cmd("get_or_create_session"), { userId: "u1" });
    const p2 = invokeWithTimeout(cmd("get_or_create_session"), { userId: "u1" });
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("noAutoDedup still opts out of dedup for an eligible infix-named command (behavior unchanged)", async () => {
    const p1 = invokeWithTimeout(cmd("dev_tools_list_kpis"), { projectId: "p1" }, { noAutoDedup: true });
    const p2 = invokeWithTimeout(cmd("dev_tools_list_kpis"), { projectId: "p1" }, { noAutoDedup: true });
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("idempotencyKey dedup is unaffected by the mutation-verb exclusion (it never consults isDedupEligible)", async () => {
    const p1 = invokeWithTimeout(cmd("dev_tools_update_kpi"), { id: "k1", value: 1 }, { idempotencyKey: "same-key" });
    const p2 = invokeWithTimeout(cmd("dev_tools_update_kpi"), { id: "k1", value: 2 }, { idempotencyKey: "same-key" });
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("still folds prefix-named read commands (pre-existing behavior preserved)", async () => {
    const p1 = invokeWithTimeout(cmd("list_personas"), {});
    const p2 = invokeWithTimeout(cmd("list_personas"), {});
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
