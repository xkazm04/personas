import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useNotificationCenterStore } from '../../stores/notificationCenterStore';
import type { ProcessType } from '../../stores/notificationCenterStore';

const PROCESS_LABELS: Record<ProcessType, string> = {
  'n8n-transform': 'n8n Transform',
  'template-adopt': 'Template Adoption',
  'rebuild': 'Agent Rebuild',
  'template-test': 'Template Test',
  'context-scan': 'Context Map Scan',
  'idea-scan': 'Idea Scan',
  'execution': 'Agent Execution',
  'matrix-build': 'Matrix Build',
  'lab-run': 'Lab Run',
  'connector-test': 'Connector Test',
  'creative-session': 'Creative Session',
};

export async function notifyProcessComplete(opts: {
  processType: ProcessType;
  personaId?: string | null;
  personaName?: string | null;
  success: boolean;
  summary: string;
  redirectSection: string;
  redirectTab?: string | null;
}): Promise<void> {
  const label = PROCESS_LABELS[opts.processType];
  const status = opts.success ? 'success' : 'failed';
  const title = opts.success ? `${label} Complete` : `${label} Failed`;
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
