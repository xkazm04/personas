import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listAllTriggers,
  listTriggers,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  getTriggerHealthMap,
  validateTrigger,
  previewCronSchedule,
  getWebhookStatus,
  dryRunTrigger,
  listCronAgents,
  listWebhookRequestLogs,
  clearWebhookRequestLogs,
  replayWebhookRequest,
  webhookRequestToCurl,
  getCompositePartialMatches,
} from "@/api/pipeline/triggers";

describe("api/pipeline/triggers", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listAllTriggers returns triggers", async () => {
    mockInvoke("list_all_triggers", [{ id: "t-1" }]);
    expect(await listAllTriggers()).toEqual([{ id: "t-1" }]);
  });

  it("listTriggers filters by personaId", async () => {
    mockInvoke("list_triggers", []);
    expect(await listTriggers("p-1")).toEqual([]);
  });

  it("createTrigger calls create_trigger", async () => {
    mockInvoke("create_trigger", { id: "t-new" });
    expect(await createTrigger({ type: "cron" } as any)).toEqual({ id: "t-new" });
  });

  it("updateTrigger calls update_trigger", async () => {
    mockInvoke("update_trigger", { id: "t-1" });
    expect(await updateTrigger("t-1", "p-1", {} as any)).toEqual({ id: "t-1" });
  });

  it("deleteTrigger returns boolean", async () => {
    mockInvoke("delete_trigger", true);
    expect(await deleteTrigger("t-1", "p-1")).toBe(true);
  });

  it("getTriggerHealthMap returns map", async () => {
    mockInvoke("get_trigger_health_map", { "t-1": "healthy" });
    expect(await getTriggerHealthMap()).toEqual({ "t-1": "healthy" });
  });

  it("validateTrigger returns validation result", async () => {
    mockInvoke("validate_trigger", { valid: true, errors: [] });
    expect(await validateTrigger("t-1")).toEqual({ valid: true, errors: [] });
  });

  it("previewCronSchedule returns preview", async () => {
    const preview = { valid: true, description: "Every hour", next_runs: [], error: null };
    mockInvoke("preview_cron_schedule", preview);
    expect(await previewCronSchedule("0 * * * *", 3)).toEqual(preview);
  });

  it("getWebhookStatus returns status", async () => {
    mockInvoke("get_webhook_status", { running: true, port: 9876 });
    expect(await getWebhookStatus()).toEqual({ running: true, port: 9876 });
  });

  it("dryRunTrigger returns dry run result", async () => {
    const result = { valid: true, validation: {}, simulated_event: null, matched_subscriptions: [] };
    mockInvoke("dry_run_trigger", result);
    expect(await dryRunTrigger("t-1")).toEqual(result);
  });

  it("listCronAgents returns agents", async () => {
    mockInvoke("list_cron_agents", []);
    expect(await listCronAgents()).toEqual([]);
  });

  it("listWebhookRequestLogs returns logs", async () => {
    mockInvoke("list_webhook_request_logs", []);
    expect(await listWebhookRequestLogs("t-1")).toEqual([]);
  });

  it("clearWebhookRequestLogs returns count", async () => {
    mockInvoke("clear_webhook_request_logs", 5);
    expect(await clearWebhookRequestLogs("t-1")).toBe(5);
  });

  it("replayWebhookRequest returns string", async () => {
    mockInvoke("replay_webhook_request", "replayed");
    expect(await replayWebhookRequest("log-1")).toBe("replayed");
  });

  it("webhookRequestToCurl returns curl command", async () => {
    mockInvoke("webhook_request_to_curl", "curl -X POST ...");
    expect(await webhookRequestToCurl("log-1")).toContain("curl");
  });

  it("getCompositePartialMatches returns results", async () => {
    mockInvoke("get_composite_partial_matches", []);
    expect(await getCompositePartialMatches()).toEqual([]);
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_all_triggers", "connection refused");
    await expect(listAllTriggers()).rejects.toThrow("connection refused");
  });
});
