/**
 * Custom persona icon API — thin wrappers over the `persona_icons` Tauri
 * commands. See `src-tauri/src/commands/core/persona_icons.rs`.
 *
 * An "asset ID" is the hex SHA-256 of the stored PNG. Wrap it with
 * `toCustomIconValue()` from `@/lib/icons/customIconStore` before writing it to
 * a persona's `icon` field.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/**
 * Import an image file (chosen via the file dialog) as a custom persona icon.
 * The backend decodes, downscales, and re-encodes it to PNG. Returns the asset
 * ID of the stored icon.
 *
 * Image decode + re-encode can take a moment for large source files, so this
 * uses a longer timeout than the default IPC call.
 */
export function importPersonaIcon(sourcePath: string): Promise<string> {
  return invoke<string>('import_persona_icon', { sourcePath }, { timeoutMs: 30_000 });
}

/** List every custom icon asset ID currently in the library. */
export function listPersonaIcons(): Promise<string[]> {
  return invoke<string[]>('list_persona_icons');
}

/** Delete a custom icon file from the library. */
export function deletePersonaIcon(assetId: string): Promise<void> {
  return invoke<void>('delete_persona_icon', { assetId });
}
