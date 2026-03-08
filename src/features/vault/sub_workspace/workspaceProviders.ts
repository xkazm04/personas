/**
 * Workspace identity providers and their downstream service mappings.
 *
 * A single OAuth consent to a workspace provider (e.g. Google) yields
 * scoped credentials for every downstream service that shares that identity.
 */

export interface WorkspaceService {
  /** Unique key used as the credential `service_type`. */
  serviceType: string;
  /** Human-readable label. */
  label: string;
  /** Short description shown during provisioning. */
  description: string;
  /** OAuth scopes required for this service. */
  scopes: string[];
  /** Icon path (connector icon convention). */
  icon: string;
  /** Accent color for the UI chip. */
  color: string;
}

export interface WorkspaceProvider {
  id: string;
  label: string;
  icon: string;
  color: string;
  services: WorkspaceService[];
}

export const GOOGLE_WORKSPACE: WorkspaceProvider = {
  id: 'google-workspace',
  label: 'Google Workspace',
  icon: '/icons/connectors/google.svg',
  color: '#4285F4',
  services: [
    {
      serviceType: 'google_gmail',
      label: 'Gmail',
      description: 'Send, read, and manage email',
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      icon: '/icons/connectors/gmail.svg',
      color: '#EA4335',
    },
    {
      serviceType: 'google_calendar',
      label: 'Google Calendar',
      description: 'Read and manage calendar events',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      icon: '/icons/connectors/google-calendar.svg',
      color: '#4285F4',
    },
    {
      serviceType: 'google_drive',
      label: 'Google Drive',
      description: 'Read and manage files',
      scopes: [
        'https://www.googleapis.com/auth/drive',
      ],
      icon: '/icons/connectors/google-drive.svg',
      color: '#0F9D58',
    },
    {
      serviceType: 'google_sheets',
      label: 'Google Sheets',
      description: 'Read and write spreadsheet data',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
      icon: '/icons/connectors/google-sheets.svg',
      color: '#34A853',
    },
  ],
};

export const WORKSPACE_PROVIDERS: WorkspaceProvider[] = [GOOGLE_WORKSPACE];

/** Collect all unique scopes for a set of services. */
export function aggregateScopes(services: WorkspaceService[]): string[] {
  const set = new Set<string>();
  for (const svc of services) {
    for (const scope of svc.scopes) set.add(scope);
  }
  return [...set];
}
