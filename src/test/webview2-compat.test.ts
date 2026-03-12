/**
 * Tests for the WebView2 compatibility layer:
 * - Runtime shim (public/webview2-compat.js)
 * - Source transform (scripts/webview2-compat.ts)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  needsTransform,
  transformForWebView2,
} from "../../scripts/webview2-compat";

// Load and execute the shim in the test environment
function loadShim() {
  const shimPath = join(process.cwd(), "public/webview2-compat.js");
  const shimCode = readFileSync(shimPath, "utf8");
  new Function(shimCode)();
}

// -- Runtime shim tests ----------------------------------------------

describe("WebView2 shim: runtime behavior", () => {
  beforeAll(() => {
    loadShim();
  });

  it("allows assigning toString on a plain object", () => {
    const obj: Record<string, unknown> = {};
    const fn = () => "custom";
    obj.toString = fn;
    expect(obj.toString).toBe(fn);
  });

  it("allows assigning constructor on a plain object", () => {
    const obj: Record<string, unknown> = {};
    function MyCtor() {}
    obj.constructor = MyCtor;
    expect(obj.constructor).toBe(MyCtor);
  });

  it("allows assigning valueOf on a plain object", () => {
    const obj: Record<string, unknown> = {};
    const fn = () => 42;
    obj.valueOf = fn;
    expect(obj.valueOf).toBe(fn);
  });

  it("preserves Object.prototype.toString for unmodified objects", () => {
    const obj = {};
    expect(typeof obj.toString).toBe("function");
    expect(obj.toString()).toBe("[object Object]");
  });

  it("preserves Object.prototype.toString.call behavior", () => {
    expect(Object.prototype.toString.call([])).toBe("[object Array]");
    expect(Object.prototype.toString.call(42)).toBe("[object Number]");
  });

  it("creates a real own property after assignment", () => {
    const obj: Record<string, unknown> = {};
    obj.toString = () => "mine";
    expect(Object.prototype.hasOwnProperty.call(obj, "toString")).toBe(true);
    const desc = Object.getOwnPropertyDescriptor(obj, "toString");
    expect(desc?.writable).toBe(true);
    expect(desc?.configurable).toBe(true);
  });
});

// -- Source transform tests ------------------------------------------

describe("WebView2 transform: simple assignments", () => {
  it("transforms prototype.constructor = constructor", () => {
    const input = `prototype.constructor = constructor;`;
    const output = transformForWebView2(input);
    expect(output).toContain("Object.defineProperty(prototype");
    expect(output).toContain("'constructor'");
    expect(output).not.toContain("prototype.constructor =");
  });

  it("transforms exports.toString = toString", () => {
    const input = `exports.toString = toString;`;
    const output = transformForWebView2(input);
    expect(output).toContain("Object.defineProperty(exports");
    expect(output).toContain("'toString'");
  });

  it("transforms P.valueOf = function() { return 1; }", () => {
    const input = `P.valueOf = function() { return 1; };`;
    const output = transformForWebView2(input);
    expect(output).toContain("Object.defineProperty(P");
    expect(output).toContain("'valueOf'");
    expect(output).toContain("function() { return 1; }");
  });

  it("does NOT transform comparisons (===)", () => {
    const input = `if (opts.constructor === Object) {}`;
    const output = transformForWebView2(input);
    expect(output).toBe(input);
  });

  it("skips built-in prototypes like Array.prototype", () => {
    const input = `Array.prototype.toString = myFn;`;
    const output = transformForWebView2(input);
    expect(output).toBe(input);
  });

  it("skips Function.prototype", () => {
    const input = `Function.prototype.toString = function(...args) { return original.apply(this, args); };`;
    const output = transformForWebView2(input);
    expect(output).toBe(input);
  });

  it("skips lines that already contain defineProperty", () => {
    const input = `Object.defineProperty(p, "constructor", { value: Ctor });`;
    const output = transformForWebView2(input);
    expect(output).toBe(input);
  });
});

describe("WebView2 transform: chained assignments", () => {
  it("decomposes P.toString = P.valueOf = fn into an IIFE", () => {
    const input = `P.toString = P.valueOf = myFn;`;
    const output = transformForWebView2(input);

    // Should NOT contain direct assignment to protected props
    expect(output).not.toMatch(/P\.toString\s*=/);
    expect(output).not.toMatch(/P\.valueOf\s*=/);

    // Should contain defineProperty for both
    expect(output).toContain("Object.defineProperty(P, 'toString'");
    expect(output).toContain("Object.defineProperty(P, 'valueOf'");

    // Should be an IIFE
    expect(output).toContain("(function()");
    expect(output).toContain("})()");
  });

  it("decomposes P.toString = P.valueOf = P.val = P.toJSON = fn", () => {
    const input = `P.toString = P.valueOf = P.val = P.toJSON = function() { return "x"; };`;
    const output = transformForWebView2(input);

    // Protected props use defineProperty
    expect(output).toContain("Object.defineProperty(P, 'toString'");
    expect(output).toContain("Object.defineProperty(P, 'valueOf'");

    // Non-protected props use direct assignment
    expect(output).toContain("P.val = _v;");
    expect(output).toContain("P.toJSON = _v;");

    // Should NOT contain direct P.toString = or P.valueOf =
    expect(output).not.toMatch(/P\.toString\s*=\s*[^{]/);
    expect(output).not.toMatch(/P\.valueOf\s*=\s*[^{]/);
  });

  it("handles the exact decimal.js-light pattern", () => {
    const input = `P.toString = P.valueOf = P.val = P.toJSON = P[Symbol.for('nodejs.util.inspect.custom')] = function () {
  var x = this,
    e = getBase10Exponent(x),
    Ctor = x.constructor;
  return toString(x, e <= Ctor.toExpNeg || e >= Ctor.toExpPos);
};`;
    const output = transformForWebView2(input);

    // Protected props use defineProperty
    expect(output).toContain("Object.defineProperty(P, 'toString'");
    expect(output).toContain("Object.defineProperty(P, 'valueOf'");

    // Non-protected props use direct assignment
    expect(output).toContain("P.val = _v;");
    expect(output).toContain("P.toJSON = _v;");
    expect(output).toContain("P[Symbol.for('nodejs.util.inspect.custom')] = _v;");

    // IIFE wrapper
    expect(output).toContain("(function()");
    expect(output).toContain("})()");

    // No direct assignment to protected props
    expect(output).not.toMatch(/\bP\.toString\s*=/);
    expect(output).not.toMatch(/\bP\.valueOf\s*=/);
  });

  it("generated IIFE is valid JavaScript", () => {
    const input = `P.toString = P.valueOf = P.val = function() { return 1; };`;
    const output = transformForWebView2(input);

    // The IIFE should be parseable
    expect(() => new Function(output)).not.toThrow();
  });

  it("generated IIFE assigns the correct value to all targets", () => {
    const input = `P.toString = P.valueOf = P.val = P.toJSON = myFn;`;
    const output = transformForWebView2(input);

    // Execute it
    const P: Record<string, unknown> = {};
    const myFn = () => "test";
    new Function("P", "myFn", output)(P, myFn);

    expect(P.toString).toBe(myFn);
    expect(P.valueOf).toBe(myFn);
    expect(P.val).toBe(myFn);
    expect(P.toJSON).toBe(myFn);
  });

  it("handles chain where only the outermost is protected", () => {
    const input = `P.toString = P.val = P.toJSON = myFn;`;
    const output = transformForWebView2(input);

    // P.val and P.toJSON are not protected, so this is a simple replacement
    // (no inner protected props -> no IIFE needed)
    expect(output).toContain("Object.defineProperty(P, 'toString'");
    // The value should contain P.val = P.toJSON = myFn (direct assignment is fine)
    expect(output).toContain("P.val = P.toJSON = myFn");
  });
});

describe("WebView2 transform: needsTransform", () => {
  it("returns true for code with .toString =", () => {
    expect(needsTransform("exports.toString = fn")).toBe(true);
  });

  it("returns false for code without protected props", () => {
    expect(needsTransform("x.foo = bar")).toBe(false);
  });
});

describe("WebView2 transform: real library files", () => {
  it("transforms actual decimal.mjs without leaving direct protected assignments", () => {
    const decimalPath = join(
      process.cwd(),
      "node_modules/decimal.js-light/decimal.mjs",
    );
    const code = readFileSync(decimalPath, "utf8");
    expect(needsTransform(code)).toBe(true);

    const transformed = transformForWebView2(code);
    expect(transformed).not.toBe(code);

    // No direct P.toString = or P.valueOf = should remain
    expect(transformed).not.toMatch(/\bP\.toString\s*=\s*[^{]/);
    expect(transformed).not.toMatch(/\bP\.valueOf\s*=\s*[^{]/);

    // Should contain defineProperty for both
    expect(transformed).toContain("Object.defineProperty(P, 'toString'");
    expect(transformed).toContain("Object.defineProperty(P, 'valueOf'");
  });

  it("transforms actual d3-color define.js", () => {
    const definePath = join(
      process.cwd(),
      "node_modules/d3-color/src/define.js",
    );
    const code = readFileSync(definePath, "utf8");
    if (needsTransform(code)) {
      const transformed = transformForWebView2(code);
      expect(transformed).toContain("Object.defineProperty");
      expect(transformed).toContain("'constructor'");
    }
  });
});

describe("WebView2 shim: shim file loads without error", () => {
  it("public/webview2-compat.js is valid JavaScript", () => {
    const shimPath = join(process.cwd(), "public/webview2-compat.js");
    const code = readFileSync(shimPath, "utf8");
    expect(() => new Function(code)).not.toThrow();
  });

  it("shim can be applied multiple times without error", () => {
    expect(() => {
      loadShim();
      loadShim();
    }).not.toThrow();
  });
});
