// Athena > Setup - the master switch, at the top of her own Setup page.
//
// Its own file rather than another entry in `SetupPanel`'s section array
// because it is the only control there that governs the others: everything
// below it (footer, orb, sound, memory, desktop awareness, tracking) is a
// preference about an Athena who is running. This one decides whether she is.
import { Power } from 'lucide-react';

import { useCompanionSwitch } from '@/features/companions/status/useCompanionSwitch';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { useTranslation } from '@/i18n/useTranslation';

export function AthenaStatusSection() {
  const { t } = useTranslation();
  const { status, loading, busy, toggle } = useCompanionSwitch('athena');

  return (
    <SettingRow
      icon={
        <Power className={`w-4 h-4 ${status?.enabled ? 'text-cyan-400' : 'text-foreground'}`} />
      }
      label={t.companions.setup.athena_enable}
      description={t.companions.setup.athena_enable_desc}
      checked={status?.enabled ?? false}
      // She has no prerequisite, so the control is only ever unavailable while
      // the status is unknown or a write is in flight.
      disabled={loading || busy || !status}
      onChange={() => void toggle()}
      testId="athena-enable-toggle"
    />
  );
}
