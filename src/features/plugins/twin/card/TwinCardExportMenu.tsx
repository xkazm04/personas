/**
 * Export the twin as a Twin Card or a Character Card V3 (spark
 * twin-portable-blueprint): pick partitions, an optional passphrase that seals
 * the personal parts, the format, then a save dialog. Mounted in the Detail
 * page header.
 *
 * The header carries only the trigger; the choices live one layer down in
 * `TwinCardExportDialog`, so the header row never grows a form.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { TwinCardExportDialog } from './TwinCardExportDialog';

export interface TwinCardExportMenuProps {
  twinId: string;
  /** Used for the suggested file name (`<slug>.twin.json`). */
  twinName: string;
}

export default function TwinCardExportMenu({ twinId, twinName }: TwinCardExportMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Download className="w-4 h-4" />}
        onClick={() => setOpen(true)}
        data-testid="twin-card-export"
        data-twin={twinId}
      >
        {t.twin.detail.export}
      </Button>
      {open && <TwinCardExportDialog twinId={twinId} twinName={twinName} onClose={() => setOpen(false)} />}
    </>
  );
}
