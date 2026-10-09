import { useState } from 'react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { setCloudSyncDataClass } from '@/api/cloudSync';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';
import type { SyncDataClass } from '@/lib/bindings/SyncDataClass';

interface SyncedDataTogglesProps {
  status: CloudSyncStatus;
  onChanged: (status: CloudSyncStatus) => void;
}

/**
 * The per-class opt-ins of the cloud sync (PHASE2-SPEC 5, owner decision M19):
 * "Sync notes" and "Sync chats". Both are OFF by default, also for someone who
 * already syncs, because each sends free text off this computer. Turning one
 * off deletes this computer's synced rows of that class at the next pass.
 */
export default function SyncedDataToggles({ status, onChanged }: SyncedDataTogglesProps) {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [busy, setBusy] = useState<SyncDataClass | null>(null);

  const toggle = async (dataClass: SyncDataClass, next: boolean) => {
    setBusy(dataClass);
    try {
      onChanged(await setCloudSyncDataClass(dataClass, next));
    } catch (e) {
      toastCatch('SyncedDataToggles:set', s.cloud_sync_class_failed)(e);
    } finally {
      setBusy(null);
    }
  };

  const rows: { dataClass: SyncDataClass; on: boolean; label: string; hint: string }[] = [
    { dataClass: 'notes', on: status.syncNotes, label: s.cloud_sync_notes_label, hint: s.cloud_sync_notes_hint },
    { dataClass: 'chats', on: status.syncChats, label: s.cloud_sync_chats_label, hint: s.cloud_sync_chats_hint },
  ];

  return (
    <div className="rounded-card border border-primary/8 bg-secondary/10 divide-y divide-primary/8">
      {rows.map((row) => (
        <div key={row.dataClass} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="typo-title">{row.label}</p>
            <p className="typo-caption text-foreground mt-0.5">{row.hint}</p>
          </div>
          <AccessibleToggle
            checked={row.on}
            onChange={() => {
              void toggle(row.dataClass, !row.on);
            }}
            disabled={busy !== null}
            label={row.label}
          />
        </div>
      ))}
    </div>
  );
}
