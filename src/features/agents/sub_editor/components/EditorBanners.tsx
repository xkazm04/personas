import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Wand2, Cloud, LogIn, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useAuthStore } from '@/stores/authStore';

type BannerColorScheme = 'amber' | 'violet' | 'sky' | 'red';

interface BannerPrimitiveProps {
  visible: boolean;
  colorScheme: BannerColorScheme;
  icon: ReactNode;
  message: ReactNode;
  actions?: ReactNode[];
  onDismiss: () => void;
  duration?: number;
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

function BannerPrimitive({ visible, colorScheme, icon, message, actions = [], onDismiss, duration = 0.25 }: BannerPrimitiveProps) {
  const palette = COLOR_SCHEMES[colorScheme];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration }}
          className="overflow-hidden"
        >
          <div className={`mx-6 my-2 rounded-xl p-3 flex items-center gap-3 ${palette.container}`}>
            {icon}
            <span className={`typo-body flex-1 ${palette.message}`}>{message}</span>
            {actions.map((action, index) => (
              <span key={index}>{action}</span>
            ))}
            <button onClick={onDismiss} className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/90 transition-colors duration-snap">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
        <button key="save" onClick={onSaveAndSwitch} className="btn-sm font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors duration-snap">
          Save & Switch
        </button>,
        <button key="discard" onClick={onDiscardAndSwitch} className="btn-sm font-medium bg-secondary/50 text-foreground/80 border border-primary/20 hover:bg-secondary/70 transition-colors duration-snap">
          Discard
        </button>,
      ]}
      onDismiss={onDismiss}
      duration={0.2}
    />
  );
}

export function DesignNudgeBanner() {
  const showDesignNudge = useSystemStore((s) => s.showDesignNudge);
  const setShowDesignNudge = useSystemStore((s) => s.setShowDesignNudge);
  const editorTab = useSystemStore((s) => s.editorTab);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  return (
    <BannerPrimitive
      visible={showDesignNudge && editorTab !== 'design'}
      colorScheme="violet"
      icon={<Wand2 className="w-4 h-4 text-violet-400 flex-shrink-0" />}
      message="Customize this template with the AI Design Wizard"
      actions={[
        <button
          key="design"
          onClick={() => { setEditorTab('design'); setShowDesignNudge(false); }}
          className="px-3 py-1 rounded-xl typo-heading bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors duration-snap"
        >
          Try Design Wizard
        </button>,
      ]}
      onDismiss={() => setShowDesignNudge(false)}
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
          <button
            key="signin"
            onClick={() => { setSidebarSection('settings'); setShowCloudNudge(false); }}
            className="px-3 py-1 rounded-xl typo-heading bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors duration-snap flex items-center gap-1.5"
          >
            <LogIn className="w-3 h-3" />
            Sign In
          </button>,
        ] : []),
        <button
          key="cloud"
          onClick={() => { setSidebarSection('cloud'); setShowCloudNudge(false); }}
          className="px-3 py-1 rounded-xl typo-heading bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors duration-snap flex items-center gap-1.5"
        >
          <Cloud className="w-3 h-3" />
          Set up Cloud
        </button>,
      ]}
      onDismiss={() => setShowCloudNudge(false)}
    />
  );
}
