// The page bridge's WebMCP polyfill must take a registration the way the
// standard's own `document.modelContext.registerTool` does, because a page is
// written against the native registry and only meets the polyfill in a build
// that lacks one. Two registrars that disagree are two validation doors: a page
// that works on one silently misbehaves on the other (a duplicate name that
// native refuses would quietly replace another script's tool here).
//
// Source of each expectation: the registerTool(tool, options) method steps of
// the WebMCP Draft Community Group Report (webmachinelearning.github.io/webmcp).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const INJECT = readFileSync(resolve(__dirname, "../../src-tauri/src/browser_bridge/webview/inject.js"), "utf8");

type Tool = { name: string; description?: string; execute?: unknown; inputSchema?: unknown };
type Registry = EventTarget & {
  polyfilled?: boolean;
  registerTool(tool: Tool, options?: { signal?: AbortSignal }): unknown;
  listTools(): Tool[];
};

const doc = document as unknown as { modelContext?: Registry };
const win = window as unknown as { __personasBridge?: string };

function install(): Registry {
  new Function(INJECT)();
  const registry = doc.modelContext;
  if (!registry?.polyfilled) throw new Error("the polyfill did not install");
  return registry;
}

const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  description: `does ${name}`,
  execute: () => "ok",
  ...extra,
});

/** How one call ended, as a page awaiting it would see it. */
async function outcome(run: () => unknown): Promise<string> {
  let returned: unknown;
  try {
    returned = run();
  } catch (error) {
    return `threw:${(error as Error).name}`;
  }
  if (!returned || typeof (returned as Promise<unknown>).then !== "function") return "not-a-promise";
  try {
    await returned;
    return "resolved";
  } catch (error) {
    return `rejected:${(error as Error).name}`;
  }
}

describe("the WebMCP polyfill's registerTool", () => {
  let registry: Registry;

  beforeEach(() => {
    delete doc.modelContext;
    delete win.__personasBridge;
    registry = install();
  });
  afterEach(() => {
    delete doc.modelContext;
    delete win.__personasBridge;
  });

  it("resolves a valid registration and lists it", async () => {
    expect(await outcome(() => registry.registerTool(tool("search")))).toBe("resolved");
    expect(registry.listTools().map((t) => t.name)).toEqual(["search"]);
  });

  it("rejects a second tool under a taken name and keeps the first", async () => {
    const first = tool("search");
    await registry.registerTool(first);
    expect(await outcome(() => registry.registerTool(tool("search", { description: "hijack" })))).toBe(
      "rejected:InvalidStateError",
    );
    expect(registry.listTools()).toEqual([first]);
  });

  it.each([
    ["an empty name", tool("")],
    ["a name with a space", tool("two words")],
    ["a name with a slash", tool("a/b")],
    ["a name over 128 code points", tool("x".repeat(129))],
    ["an empty description", tool("search", { description: "" })],
  ])("rejects %s with InvalidStateError", async (_label, bad) => {
    expect(await outcome(() => registry.registerTool(bad))).toBe("rejected:InvalidStateError");
    expect(registry.listTools()).toEqual([]);
  });

  it("rejects a missing execute callback instead of throwing", async () => {
    expect(await outcome(() => registry.registerTool(tool("search", { execute: undefined })))).toBe("rejected:TypeError");
  });

  it("rejects an input schema that cannot be serialized", async () => {
    const circular: Record<string, unknown> = { type: "object" };
    circular.self = circular;
    expect(await outcome(() => registry.registerTool(tool("search", { inputSchema: circular })))).toBe(
      "rejected:TypeError",
    );
    expect(registry.listTools()).toEqual([]);
  });

  it("rejects with the abort reason when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("gone", "AbortError"));
    expect(await outcome(() => registry.registerTool(tool("search"), { signal: controller.signal }))).toBe(
      "rejected:AbortError",
    );
    expect(registry.listTools()).toEqual([]);
  });

  it("unregisters on abort and announces each change", async () => {
    let changes = 0;
    registry.addEventListener("toolchange", () => changes++);
    const controller = new AbortController();
    await registry.registerTool(tool("search"), { signal: controller.signal });
    await registry.registerTool(tool("alpha"));
    expect(registry.listTools().map((t) => t.name)).toEqual(["alpha", "search"]);
    controller.abort();
    expect(registry.listTools().map((t) => t.name)).toEqual(["alpha"]);
    expect(changes).toBe(3);
  });
});
