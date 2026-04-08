/**
 * Helpers for calling the localhost management HTTP API (port 9420) from the
 * desktop frontend.
 *
 * The management API gates every route behind a Bearer token. Inside the
 * Tauri app we mint a process-scoped "system" key on first startup and fetch
 * it via the `get_system_api_key` command. This module memoizes that fetch
 * so call sites don't need to know the bootstrap protocol.
 */

import { getSystemApiKey } from "@/api/auth/externalApiKeys";

const MANAGEMENT_API_BASE = "http://127.0.0.1:9420";

let cachedKey: Promise<string> | null = null;

function loadKey(): Promise<string> {
  if (cachedKey === null) {
    cachedKey = getSystemApiKey().catch((err) => {
      // Drop the cached failure so retries can recover.
      cachedKey = null;
      throw err;
    });
  }
  return cachedKey;
}

/**
 * Fetch wrapper that injects the system Bearer token before delegating to the
 * standard `fetch` API. Mirrors the upstream signature so existing call sites
 * can be migrated by replacement.
 */
export async function managementFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = await loadKey();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${key}`);
  const url = path.startsWith("http") ? path : `${MANAGEMENT_API_BASE}${path}`;
  return fetch(url, { ...init, headers });
}
