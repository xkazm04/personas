/**
 * Tauri IPC mock helpers for tests.
 *
 * Usage:
 *   import { mockInvoke, mockInvokeOnce } from "@/test/tauriMock";
 *
 *   mockInvoke("list_personas", [{ id: "1", name: "Test" }]);
 *   // or for one-shot:
 *   mockInvokeOnce("list_personas", [{ id: "1", name: "Test" }]);
 */
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = vi.mocked(invoke);

/**
 * Mock a specific Tauri command to always return the given value.
 * Adds a new implementation that checks the command name.
 */
export function mockInvoke(command: string, returnValue: unknown): void {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === command) return returnValue;
    return undefined;
  });
}

/**
 * Mock a specific Tauri command to return the given value once.
 */
export function mockInvokeOnce(command: string, returnValue: unknown): void {
  mockedInvoke.mockImplementationOnce(async (cmd: string) => {
    if (cmd === command) return returnValue;
    return undefined;
  });
}

/**
 * Mock multiple Tauri commands at once.
 * Keys are command names, values are return values.
 */
export function mockInvokeMap(commands: Record<string, unknown>): void {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd in commands) return commands[cmd];
    return undefined;
  });
}

/**
 * Mock a Tauri command to reject with an error.
 */
export function mockInvokeError(command: string, error: string): void {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === command) throw new Error(error);
    return undefined;
  });
}

/**
 * Reset all invoke mocks to default (returns undefined).
 */
export function resetInvokeMocks(): void {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(undefined);
}
