import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useNotificationCenterStore } from '../../stores/notificationCenterStore';
import type { ProcessType } from '../../stores/notificationCenterStore';
import { en, type Translations } from '@/i18n/en';

/** Map ProcessType (kebab-case) to the corresponding i18n key (snake_case). */
const PROCESS_LABEL_KEYS: Record<ProcessType, keyof Translations['process_labels']> = {
  'n8n-transform': 'n8n_transform',
  'template-adopt': 'template_adopt',
  'rebuild': 'rebuild',
  'template-test': 'template_test',
  'context-scan': 'context_scan',
  'idea-scan': 'idea_scan',
  'execution': 'execution',
  'matrix-build': 'matrix_build',
  'lab-run': 'lab_run',
  'connector-test': 'connector_test',
  'creative-session': 'creative_session',
};

/** Resolve a ProcessType to its human-readable label from the given translations. */
export function getProcessLabel(processType: ProcessType, t: Translations = en): string {
  const key = PROCESS_LABEL_KEYS[processType];
  return (t.process_labels[key] as string) ?? processType;
}

export async function notifyProcessComplete(opts: {
  processType: ProcessType;
  personaId?: string | null;
  personaName?: string | null;
  success: boolean;
  summary: string;
  redirectSection: string;
  redirectTab?: string | null;
}, t: Translations = en): Promise<void> {
  const label = getProcessLabel(opts.processType, t);
  const status = opts.success ? 'success' : 'failed';
  const suffix = opts.success
    ? t.process_labels.complete_suffix
    : t.process_labels.failed_suffix;
  const title = `${label} ${suffix}`;
  const body = opts.personaName ? `${opts.personaName}: ${opts.summary}` : opts.summary;

  // OS notification
  try {
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const permission = await requestPermission();
      permitted = permission === 'granted';
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch {
    // Tauri notification API unavailable (e.g., in dev browser)
  }

  // App notification center
  useNotificationCenterStore.getState().addProcessNotification({
    processType: opts.processType,
    personaId: opts.personaId ?? null,
    personaName: opts.personaName ?? null,
    status,
    summary: opts.summary,
    redirectSection: opts.redirectSection,
    redirectTab: opts.redirectTab ?? null,
  });
}
