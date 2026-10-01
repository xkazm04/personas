/**
 * Export the twin as a Twin Card or a Character Card V3 (spark
 * twin-portable-blueprint): pick partitions, an optional passphrase that seals
 * the personal parts, the format, then a save dialog. Mounted in the Detail
 * page header.
 *
 * CONTRACT STUB (WP0): the menu lands in WP5. Props frozen.
 */
export interface TwinCardExportMenuProps {
  twinId: string;
  /** Used for the suggested file name (`<slug>.twin.json`). */
  twinName: string;
}

export default function TwinCardExportMenu({ twinId }: TwinCardExportMenuProps) {
  return <span data-testid="twin-card-export" data-twin={twinId} />;
}
