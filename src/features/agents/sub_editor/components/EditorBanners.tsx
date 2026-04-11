import { AlertTriangle, Cloud, LogIn, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useAuthStore } from '@/stores/authStore';
import Button from '@/features/shared/components/buttons/Button';

type BannerColorScheme = 'amber' | 'violet' | 'sky' | 'red';

interface BannerPrimitiveProps {
  visible: boolean;
  colorScheme: BannerColorScheme;
  icon: ReactNode;
  message: ReactNode;
  actions?: ReactNode[];
  onDismiss: () => void;
}

const COLOR_SCHEMES: Record<BannerColorScheme, { container: string; message: string }> = {
  amber: {
    container: 'bg-amber-500/10 border border-amber-500/20',
    message: 'text-amber-400/90',
  },
  violet: {
    container: 'bg-violet-500/10 border border-violet-500/20',
    message: 'text-violet-300/90',
  },
  sky: {
    container: 'bg-sky-500/10 border border-sky-500/20',
    message: 'text-sky-300/90',
  },
  red: {
    container: 'bg-red-500/10 border border-red-500/20',
    message: 'text-red-300/90',
  },
};

function BannerPrimitive({ visible, colorScheme, icon, message, actions = [], onDismiss }: BannerPrimitiveProps) {
  const palette = COLOR_SCHEMES[colorScheme];

  return (
    <>
      {visible && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className={`mx-6 my-2 rounded-xl p-3 flex items-center gap-3 ${palette.container}`}>
            {icon}
            <span className={`typo-body flex-1 ${palette.message}`}>{message}</span>
            {actions.map((action, index) => (
              <span key={index}>{action}</span>
            ))}
            <Button variant="ghost" size="icon-sm" onClick={onDismiss} className="w-7 h-7">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

interface UnsavedBannerProps {
  visible: boolean;
  changedSections: string[];
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onDismiss: () => void;
}

export function UnsavedChangesBanner({
  visible, changedSections, onSaveAndSwitch, onDiscardAndSwitch, onDismiss,
}: UnsavedBannerProps) {
  return (
    <BannerPrimitive
      visible={visible}
      colorScheme="amber"
      icon={<AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
      message={`Unsaved changes${changedSections.length > 0 ? `: ${changedSections.join(', ')}` : ''}`}
      actions={[
        <Button key="save" variant="accent" accentColor="amber" size="sm" onClick={onSaveAndSwitch}>
          Save & Switch
        </Button>,
        <Button key="discard" variant="secondary" size="sm" onClick={onDiscardAndSwitch}>
          Discard
        </Button>,
      ]}
      onDismiss={onDismiss}
    />
  );
}

interface PartialLoadBannerProps {
  warnings: string[];
  onDismiss: () => void;
}

export function PartialLoadBanner({ warnings, onDismiss }: PartialLoadBannerProps) {
  return (
    <BannerPrimitive
      visible={warnings.length > 0}
      colorScheme="amber"
      icon={<AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
      message={`Partial load: ${warnings.join('; ')}`}
      onDismiss={onDismiss}
    />
  );
}

export function CloudNudgeBanner() {
  const showCloudNudge = useSystemStore((s) => s.showCloudNudge);
  const setShowCloudNudge = useSystemStore((s) => s.setShowCloudNudge);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <BannerPrimitive
      visible={showCloudNudge}
      colorScheme="sky"
      icon={<Cloud className="w-4 h-4 text-sky-400 flex-shrink-0" />}
      message={isAuthenticated
        ? 'Connect a cloud orchestrator to run personas remotely'
        : 'Sign in to unlock cloud features and remote execution'}
      actions={[
        ...(!isAuthenticated ? [
          <Button
            key="signin"
            variant="accent"
            accentColor="sky"
            size="sm"
            icon={<LogIn className="w-3 h-3" />}
            onClick={() => { setSidebarSection('settings'); setShowCloudNudge(false); }}
          >
            Sign In
          </Button>,
        ] : []),
        <Button
          key="cloud"
          variant="accent"
          accentColor="sky"
          size="sm"
          icon={<Cloud className="w-3 h-3" />}
          onClick={() => { setSidebarSection('personas'); useSystemStore.getState().setAgentTab('cloud'); setShowCloudNudge(false); }}
        >
          Set up Cloud
        </Button>,
      ]}
      onDismiss={() => setShowCloudNudge(false)}
    />
  );
}
