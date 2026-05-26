/**
 * Build an `obsidian://open` deep link that opens a specific vault-relative
 * note. Normalizes backslashes to forward slashes and strips the `.md`
 * extension so Obsidian opens the exact note — a bare basename ambiguously
 * matches any same-named file elsewhere in the vault.
 */
export function buildObsidianOpenUri(vaultName: string, notePath: string): string {
  const filePath = notePath.replace(/\\/g, '/').replace(/\.md$/, '');
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
}

/**
 * Navigate to the `obsidian://` deep link for a note. No-ops when the vault
 * name is unknown (e.g. before a vault is connected), so callers can wire it
 * directly to a click handler without guarding first.
 */
export function openNoteInObsidian(vaultName: string | null | undefined, notePath: string): void {
  if (!vaultName) return;
  window.location.href = buildObsidianOpenUri(vaultName, notePath);
}
