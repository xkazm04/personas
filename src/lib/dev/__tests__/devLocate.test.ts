import { describe, it, expect, beforeEach } from "vitest";

import {
  buildChain,
  dedupeChain,
  isLibraryPath,
  parseLoc,
  pickDefaultIndex,
} from "../devLocate";

describe("devLocate", () => {
  describe("parseLoc", () => {
    it("splits path:line:col into a copyable path:line", () => {
      const r = parseLoc("src/features/teams/sub_goals/GoalsPage.tsx:88:7");
      expect(r).toEqual({
        raw: "src/features/teams/sub_goals/GoalsPage.tsx:88:7",
        path: "src/features/teams/sub_goals/GoalsPage.tsx",
        line: 88,
        loc: "src/features/teams/sub_goals/GoalsPage.tsx:88",
      });
    });

    it("returns null for malformed values", () => {
      expect(parseLoc("not-a-loc")).toBeNull();
      expect(parseLoc("src/x.tsx:88")).toBeNull();
    });
  });

  describe("isLibraryPath", () => {
    it("treats shared/lib as library, feature folders as call sites", () => {
      expect(isLibraryPath("src/features/shared/components/buttons/Button.tsx")).toBe(true);
      expect(isLibraryPath("src/lib/ui/BaseModal.tsx")).toBe(true);
      expect(isLibraryPath("src/features/teams/sub_goals/GoalsPage.tsx")).toBe(false);
    });
  });

  describe("buildChain + pickDefaultIndex (call-site resolution)", () => {
    beforeEach(() => {
      document.body.innerHTML = "";
    });

    it("resolves the call site by default and the innermost via Alt", () => {
      // A shared <Button> (its internals live in shared/) used inside a feature
      // page. Clicking the button's inner <span> should default to the page.
      document.body.innerHTML = `
        <section data-loc="src/features/teams/sub_goals/GoalsPage.tsx:88:1">
          <div data-loc="src/features/shared/components/buttons/Button.tsx:10:1">
            <span id="hit" data-loc="src/features/shared/components/buttons/Button.tsx:11:1">Save</span>
          </div>
        </section>`;
      const hit = document.getElementById("hit")!;
      const chain = buildChain(hit);

      expect(chain.map((c) => c.loc)).toEqual([
        "src/features/shared/components/buttons/Button.tsx:11",
        "src/features/shared/components/buttons/Button.tsx:10",
        "src/features/teams/sub_goals/GoalsPage.tsx:88",
      ]);

      // Default = first non-library = the feature page (the call site).
      const di = pickDefaultIndex(chain);
      expect(chain[di]!.loc).toBe("src/features/teams/sub_goals/GoalsPage.tsx:88");
      // Alt+click target = innermost = the shared component internal.
      expect(chain[0]!.loc).toBe("src/features/shared/components/buttons/Button.tsx:11");
    });

    it("falls back to innermost when everything is library code", () => {
      document.body.innerHTML = `
        <div data-loc="src/lib/ui/BaseModal.tsx:5:1">
          <span id="hit" data-loc="src/features/shared/components/buttons/Button.tsx:11:1">x</span>
        </div>`;
      const chain = buildChain(document.getElementById("hit")!);
      expect(pickDefaultIndex(chain)).toBe(0);
    });

    it("returns the element itself when it is already a feature file", () => {
      document.body.innerHTML = `<button id="hit" data-loc="src/features/teams/sub_goals/GoalsPage.tsx:120:3">Go</button>`;
      const chain = buildChain(document.getElementById("hit")!);
      expect(chain).toHaveLength(1);
      expect(pickDefaultIndex(chain)).toBe(0);
    });

    it("ignores elements without data-loc", () => {
      document.body.innerHTML = `<div><span id="hit">no loc</span></div>`;
      expect(buildChain(document.getElementById("hit")!)).toEqual([]);
    });
  });

  describe("dedupeChain", () => {
    it("collapses consecutive same path:line entries", () => {
      document.body.innerHTML = `
        <div data-loc="src/features/a/A.tsx:5:1">
          <em data-loc="src/features/a/A.tsx:5:9"></em>
        </div>`;
      // Different columns -> different loc only if line differs; here lines
      // differ in raw but loc uses path:line. Build a synthetic same-loc chain:
      const a = { el: document.body, raw: "x:1:1", loc: "x:1", path: "x", line: 1 };
      const b = { el: document.body, raw: "x:1:9", loc: "x:1", path: "x", line: 1 };
      const c = { el: document.body, raw: "y:2:1", loc: "y:2", path: "y", line: 2 };
      expect(dedupeChain([a, b, c]).map((e) => e.loc)).toEqual(["x:1", "y:2"]);
    });
  });
});
