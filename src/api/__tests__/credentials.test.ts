import { describe, it, expect, beforeEach } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  getCredentialBlastRadius,
  listCredentialEvents,
  listAllCredentialEvents,
  getSessionPublicKey,
  healthcheckCredential,
  vaultStatus,
  listCredentialFields,
  updateCredentialField,
  getCredentialAuditLog,
  getCredentialUsageStats,
  getCredentialDependents,
} from "@/api/vault/credentials";

const mockedInvoke = vi.mocked(invoke);

describe("api/vault/credentials", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listCredentials calls list_credentials", async () => {
    mockInvoke("list_credentials", []);
    const result = await listCredentials();
    expect(result).toEqual([]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_credentials", undefined, expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it("createCredential calls create_credential", async () => {
    const cred = { id: "c-1", name: "test" };
    mockInvoke("create_credential", cred);
    const result = await createCredential({ name: "test" } as unknown);
    expect(result).toEqual(cred);
  });

  it("updateCredential calls update_credential", async () => {
    const cred = { id: "c-1", name: "updated" };
    mockInvoke("update_credential", cred);
    const result = await updateCredential("c-1", { name: "updated" } as unknown);
    expect(result).toEqual(cred);
  });

  it("deleteCredential returns boolean", async () => {
    mockInvoke("delete_credential", true);
    expect(await deleteCredential("c-1")).toBe(true);
  });

  it("getCredentialBlastRadius returns items", async () => {
    mockInvoke("credential_blast_radius", [{ category: "agents", description: "3 agents" }]);
    const result = await getCredentialBlastRadius("c-1");
    expect(result).toHaveLength(1);
  });

  it("listCredentialEvents calls list_credential_events", async () => {
    mockInvoke("list_credential_events", []);
    expect(await listCredentialEvents("c-1")).toEqual([]);
  });

  it("listAllCredentialEvents calls list_all_credential_events", async () => {
    mockInvoke("list_all_credential_events", []);
    expect(await listAllCredentialEvents()).toEqual([]);
  });

  it("getSessionPublicKey returns key string", async () => {
    mockInvoke("get_session_public_key", "pk-abc123");
    expect(await getSessionPublicKey()).toBe("pk-abc123");
  });

  it("healthcheckCredential returns result", async () => {
    const hc = { healthy: true, message: "ok" };
    mockInvoke("healthcheck_credential", hc);
    expect(await healthcheckCredential("c-1")).toEqual(hc);
  });

  it("vaultStatus returns status", async () => {
    mockInvoke("vault_status", { encrypted: true });
    expect(await vaultStatus()).toEqual({ encrypted: true });
  });

  it("listCredentialFields returns field metadata", async () => {
    mockInvoke("list_credential_fields", [{ key: "token", sensitive: true }]);
    const result = await listCredentialFields("c-1");
    expect(result).toHaveLength(1);
  });

  it("updateCredentialField returns boolean", async () => {
    mockInvoke("update_credential_field", true);
    expect(await updateCredentialField("c-1", "token", "encrypted-val")).toBe(true);
  });

  it("getCredentialAuditLog returns entries", async () => {
    mockInvoke("credential_audit_log", []);
    expect(await getCredentialAuditLog("c-1")).toEqual([]);
  });

  it("getCredentialUsageStats returns stats", async () => {
    mockInvoke("credential_usage_stats", { totalUses: 42 });
    expect(await getCredentialUsageStats("c-1")).toEqual({ totalUses: 42 });
  });

  it("getCredentialDependents returns dependents", async () => {
    mockInvoke("credential_dependents", []);
    expect(await getCredentialDependents("c-1")).toEqual([]);
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_credentials", "vault locked");
    await expect(listCredentials()).rejects.toThrow("vault locked");
  });
});
