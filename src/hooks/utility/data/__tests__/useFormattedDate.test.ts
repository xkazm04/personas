import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFormattedDate } from "../useFormattedDate";
import { useI18nStore } from "@/stores/i18nStore";

const TS = Date.UTC(2026, 0, 15, 10, 30, 0);

function setLanguage(language: "en" | "ja" | "de") {
  useI18nStore.setState({ language });
}

describe("useFormattedDate", () => {
  afterEach(() => { setLanguage("en"); });

  it("returns '' for null/undefined and for an unparseable timestamp", () => {
    expect(renderHook(() => useFormattedDate(null)).result.current).toBe("");
    expect(renderHook(() => useFormattedDate(undefined)).result.current).toBe("");
    expect(renderHook(() => useFormattedDate("not a date")).result.current).toBe("");
  });

  it("formats in the ACTIVE UI language, not the runtime locale", () => {
    setLanguage("en");
    const en = renderHook(() =>
      useFormattedDate(TS, { dateStyle: "long" }),
    ).result.current;

    setLanguage("ja");
    const ja = renderHook(() =>
      useFormattedDate(TS, { dateStyle: "long" }),
    ).result.current;

    // The whole point of the fix: switching the app language changes the
    // rendered date. Before it, both calls produced the OS locale's output.
    expect(ja).not.toBe(en);
    expect(ja).toBe(new Date(TS).toLocaleString("ja", { dateStyle: "long" }));
    expect(en).toBe(new Date(TS).toLocaleString("en", { dateStyle: "long" }));
  });

  it("still honours an explicit locale override", () => {
    setLanguage("ja");
    const { result } = renderHook(() =>
      useFormattedDate(TS, { locale: "de", dateStyle: "long" }),
    );
    expect(result.current).toBe(
      new Date(TS).toLocaleString("de", { dateStyle: "long" }),
    );
  });
});
