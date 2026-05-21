/**
 * Custom Persona Icons — value scheme + file-path resolution.
 *
 * A user-uploaded (or, later, AI-generated) persona icon is stored as a PNG
 * under `{app_data_dir}/persona-icons/{assetId}.png`, where `assetId` is the
 * SHA-256 content hash of the re-encoded file (so identical uploads dedupe to
 * one file). The persona's `icon` column holds `custom-icon:{assetId}`.
 *
 * Rendering needs a webview-loadable URL, which means resolving the app-data
 * directory (async, Tauri-only) and running it through `convertFileSrc`. The
 * directory never changes within a session, so it's resolved once and cached.
 *
 * Convention mirrors `agentIconCatalog.ts` (`agent-icon:{id}`).
 */

import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

// ── Value scheme ──────────────────────────────────────────────────────────────

export const CUSTOM_ICON_PREFIX = 'custom-icon:';

/** Subdirectory of app-data where custom icon files live. */
export const PERSONA_ICONS_DIRNAME = 'persona-icons';

/** Every custom icon is re-encoded to PNG on import, so the extension is fixed. */
export const CUSTOM_ICON_EXT = 'png';

/** Check if a persona icon value is a custom-icon reference. */
export function isCustomIcon(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith(CUSTOM_ICON_PREFIX);
}

/** Extract the asset ID from a custom-icon value (`custom-icon:abc` → `abc`). */
export function parseCustomIconId(icon: string): string {
  return icon.slice(CUSTOM_ICON_PREFIX.length);
}

/** Build the custom-icon value from an asset ID. */
export function toCustomIconValue(assetId: string): string {
  return `${CUSTOM_ICON_PREFIX}${assetId}`;
}

// ── App-data directory cache ──────────────────────────────────────────────────

let cachedDir: string | null = null;
let dirPromise: Promise<string> | null = null;

/**
 * Resolve (and cache) the OS app-data directory. Safe to call repeatedly —
 * the underlying `appDataDir()` IPC runs at most once per session. Warm this
 * early (see `main.tsx`) so the first custom-icon render is synchronous.
 */
export function ensureAppDataDir(): Promise<string> {
  if (cachedDir !== null) return Promise.resolve(cachedDir);
  if (!dirPromise) {
    dirPromise = appDataDir()
      .then((dir) => {
        cachedDir = dir.replace(/[\\/]+$/, '');
        return cachedDir;
      })
      .catch((err) => {
        // Allow a later retry rather than caching the rejection forever.
        dirPromise = null;
        throw err;
      });
  }
  return dirPromise;
}

/**
 * Build a webview-loadable `asset:` URL for a custom icon. Returns `null` when
 * the app-data directory hasn't resolved yet — callers should fall back to a
 * placeholder and re-render once `ensureAppDataDir()` settles (the
 * `useCustomIconSrc` hook does this automatically).
 */
export function customIconSrc(assetId: string): string | null {
  if (cachedDir === null) return null;
  return convertFileSrc(
    `${cachedDir}/${PERSONA_ICONS_DIRNAME}/${assetId}.${CUSTOM_ICON_EXT}`,
  );
}

/**
 * React hook: resolve a custom icon's `asset:` URL, kicking off the app-data
 * directory lookup if it hasn't run yet. Returns `null` until ready (and for
 * a null/empty `assetId`).
 */
export function useCustomIconSrc(assetId: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    assetId ? customIconSrc(assetId) : null,
  );

  useEffect(() => {
    if (!assetId) {
      setSrc(null);
      return;
    }
    const immediate = customIconSrc(assetId);
    if (immediate) {
      setSrc(immediate);
      return;
    }
    let alive = true;
    ensureAppDataDir()
      .then(() => {
        if (alive) setSrc(customIconSrc(assetId));
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  return src;
}
