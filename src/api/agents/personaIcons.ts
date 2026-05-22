/**
 * Custom persona icon API — thin wrappers over the `persona_icons` Tauri
 * commands. See `src-tauri/src/commands/core/persona_icons.rs`.
 *
 * An "asset ID" is the hex SHA-256 of the stored PNG. Wrap it with
 * `toCustomIconValue()` from `@/lib/icons/customIconStore` before writing it to
 * a persona's `icon` field.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ImageGenCredential } from '@/lib/bindings/ImageGenCredential';

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

/**
 * List vault credentials capable of generating images (Leonardo AI,
 * Higgsfield). Empty when the user has no such credential — the picker hides
 * its "Generate with AI" section in that case.
 */
export function listImageGenCredentials(): Promise<ImageGenCredential[]> {
  return invoke<ImageGenCredential[]>('list_image_gen_credentials');
}

/**
 * Generate a persona icon from a text prompt using a vault image-gen
 * credential. Returns the stored asset ID. The provider runs an async job
 * (POST + poll), so this can take up to ~2 minutes — hence the long timeout.
 */
export function generatePersonaIcon(credentialId: string, prompt: string): Promise<string> {
  return invoke<string>(
    'generate_persona_icon',
    { credentialId, prompt },
    { timeoutMs: 150_000 },
  );
}
