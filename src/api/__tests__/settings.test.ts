import { describe, it, expect, beforeEach } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import { getAppSetting, setAppSetting, deleteAppSetting } from "@/api/system/settings";

const mockedInvoke = vi.mocked(invoke);

describe("api/system/settings", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("getAppSetting returns value", async () => {
    mockInvoke("get_app_setting", "dark");
    expect(await getAppSetting("theme")).toBe("dark");
    expect(mockedInvoke).toHaveBeenCalledWith(
      "get_app_setting",
      expect.objectContaining({ key: "theme" }),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("getAppSetting returns null for missing key", async () => {
    mockInvoke("get_app_setting", null);
    expect(await getAppSetting("nonexistent")).toBeNull();
  });

  it("setAppSetting resolves", async () => {
    mockInvoke("set_app_setting", undefined);
    await expect(setAppSetting("theme", "dark")).resolves.toBeUndefined();
  });

  it("deleteAppSetting returns boolean", async () => {
    mockInvoke("delete_app_setting", true);
    expect(await deleteAppSetting("theme")).toBe(true);
  });

  it("rejects on backend error", async () => {
    mockInvokeError("get_app_setting", "db locked");
    await expect(getAppSetting("theme")).rejects.toThrow("db locked");
  });
});
