// An unreadable folder rendered its reason as "[object Object]": useDrive
// String()-ed the IPC rejection, which invokeWithTimeout delivers as the
// serialized AppError OBJECT, never an Error. The hook now keeps the raw
// rejection and the scenario resolves it at render.
import { renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { preloadSectionsAsync, useTranslation } from "@/i18n/useTranslation";

import type { DriveApi } from "../../types";
import { finderEmptyVariant, finderScenario } from "../finderScenario";

describe("finderScenario unreadable", () => {
  beforeAll(async () => {
    await preloadSectionsAsync("en", ["plugins"]);
  });

  const appError = { error: "Not found: reports", kind: "not_found" };
  const drive = {
    error: appError,
    loading: false,
    entries: [],
    visibleEntries: [],
    searchQuery: "",
    refresh: () => {},
  } as DriveApi; // test double: only the fields the builder reads

  it("treats a rejection object as unreadable", () => {
    expect(finderEmptyVariant(drive, null)).toBe("unreadable");
  });

  it("never renders the AppError as [object Object]", () => {
    const { result } = renderHook(() => useTranslation());
    const { t, tx } = result.current;
    const props = finderScenario("unreadable", { t, tx, drive });
    expect(String(props.subtitle)).not.toContain("[object Object]");
    expect(String(props.subtitle).length).toBeGreaterThan(0);
  });
});
